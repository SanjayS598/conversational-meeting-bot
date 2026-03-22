import axios from 'axios';
import WebSocket from 'ws';
import { config } from '../config';
import { gatewayEmitter } from '../events/emitter';
import { ZoomJoiner } from './zoom-joiner';
import { geminiBrainClient } from './gemini-brain-client';
import { parseZoomUrl } from '../utils/zoom-url';
import type {
  Session,
  SessionStatus,
  SessionEvent,
  StartSessionInput,
} from '../types/index';

// ---------------------------------------------------------------------------
// Internal state per active session
// ---------------------------------------------------------------------------

interface ActiveSession {
  session: Session;
  joiner: ZoomJoiner;
  /** WebSocket clients subscribed to inbound meeting audio. */
  audioInClients: Set<WebSocket>;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

class SessionManager {
  private readonly sessions = new Map<string, ActiveSession>();

  // ── Public API ────────────────────────────────────────────────────────────

  /** Create and asynchronously start a bot session. Returns immediately with 'created' status. */
  async startSession(input: StartSessionInput): Promise<Session> {
    // Idempotency: return existing session if already started with this ID
    const existing = this.sessions.get(input.meeting_session_id);
    if (existing) return existing.session;

    if (this.sessions.size >= config.maxConcurrentSessions) {
      throw new Error(
        `Maximum concurrent sessions (${config.maxConcurrentSessions}) reached`,
      );
    }

    const { meetingId } = parseZoomUrl(input.meeting_url);

    const session: Session = {
      id: input.meeting_session_id,
      meeting_session_id: input.meeting_session_id,
      user_id: input.user_id,
      meeting_url: input.meeting_url,
      meeting_id: meetingId,
      status: 'created',
      created_at: new Date(),
      bot_display_name: input.bot_display_name ?? config.botDisplayName,
    };

    let _audioChunkCount = 0;
    const joiner = new ZoomJoiner(session.id, {
      onAudioChunk: (int16Array) => {
        _audioChunkCount++;
        if (_audioChunkCount === 1 || _audioChunkCount % 500 === 0) {
          console.log(`[SessionManager] audio chunks received session=${session.id} count=${_audioChunkCount}`);
        }
        geminiBrainClient.sendAudio(session.id, int16Array);
        this.broadcastAudioChunk(session.id, int16Array);
      },
      onStatusChange: (status, error) => {
        this.updateStatus(session.id, status, error);
      },
    });

    this.sessions.set(session.id, { session, joiner, audioInClients: new Set() });
    this.emit('session.created', session.id);

    // Join async — caller gets a 202 immediately; status events track progress
    this.doJoin(session, joiner, input.passcode, input.meeting_objective, input.prep_notes).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SessionManager] Join failed for ${session.id}: ${msg}`);
      this.updateStatus(session.id, 'failed', msg);
    });

    return session;
  }

  async stopSession(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active) throw new Error(`Session not found: ${sessionId}`);

    await active.joiner.cleanup();
    active.session.ended_at = new Date();

    // Close the brain session first so the backend can flush the last audio buffer.
    await geminiBrainClient.stopSession(sessionId).catch(() => {});

    this.updateStatus(sessionId, 'ended');
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  listSessions(): Session[] {
    return Array.from(this.sessions.values()).map((a) => a.session);
  }

  // ── Audio WebSocket subscription ──────────────────────────────────────────

  /** Subscribe a WS client to receive raw PCM audio captured from the meeting. */
  subscribeAudioIn(sessionId: string, ws: WebSocket): void {
    const active = this.sessions.get(sessionId);
    if (!active) {
      ws.close(1008, `Session not found: ${sessionId}`);
      return;
    }
    active.audioInClients.add(ws);
    ws.once('close', () => active.audioInClients.delete(ws));
  }

  /**
   * Receive synthesised speech audio from the ElevenLabs Voice Runtime and
   * inject it into the meeting.
   *
   * Expected wire format: raw int16 PCM, little-endian, 16 kHz mono.
   */
  async receiveAudioOut(sessionId: string, data: Buffer): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active) return;

    const int16Array: number[] = [];
    for (let i = 0; i < data.length; i += 2) {
      int16Array.push(data.readInt16LE(i));
    }

    await active.joiner.injectAudio(int16Array);
    this.emit('audio.chunk.played', sessionId);
  }

  // ── Private: join ─────────────────────────────────────────────────────────

  private async doJoin(
    session: Session,
    joiner: ZoomJoiner,
    passcode?: string,
    meetingObjective?: string,
    prepNotes?: string,
  ): Promise<void> {
    await joiner.join(session.meeting_url, session.bot_display_name, passcode);
    const active = this.sessions.get(session.id);
    if (active) active.session.joined_at = new Date();

    // Start Gemini brain session now that we've joined the meeting
    geminiBrainClient.startSession(session.id, {
      meetingObjective: meetingObjective ?? `Attend and take notes for meeting at ${session.meeting_url}`,
      prepNotes,
    }).catch((err: unknown) => {
      console.warn(`[SessionManager] Gemini brain start failed for ${session.id}:`, err);
    });
  }

  // ── Private: audio broadcast ──────────────────────────────────────────────

  private broadcastAudioChunk(sessionId: string, int16Array: number[]): void {
    const active = this.sessions.get(sessionId);
    if (!active || active.audioInClients.size === 0) return;

    // Wire format: [8 bytes timestamp BigInt64LE] + [N * 2 bytes int16 PCM]
    const header = Buffer.allocUnsafe(8);
    header.writeBigInt64LE(BigInt(Date.now()), 0);

    const pcm = Buffer.allocUnsafe(int16Array.length * 2);
    for (let i = 0; i < int16Array.length; i++) {
      pcm.writeInt16LE(int16Array[i], i * 2);
    }

    const packet = Buffer.concat([header, pcm]);

    for (const ws of active.audioInClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(packet);
      }
    }

    this.emit('audio.chunk.received', sessionId);
  }

  // ── Private: status & events ──────────────────────────────────────────────

  private updateStatus(sessionId: string, status: SessionStatus, error?: string): void {
    const active = this.sessions.get(sessionId);
    if (!active) return;

    active.session.status = status;
    if (error) active.session.error = error;

    this.emit(`session.${status}` as SessionEvent['type'], sessionId, { error });
    this.notifyControlBackend(active.session);
  }

  private emit(
    type: SessionEvent['type'],
    sessionId: string,
    payload?: Record<string, unknown>,
  ): void {
    gatewayEmitter.emitEvent({
      type,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      payload,
    });
  }

  /** Best-effort push of session state to the Control Backend. */
  private async notifyControlBackend(session: Session): Promise<void> {
    try {
      console.log(`[SessionManager] notifyControlBackend session=${session.id} status=${session.status}`);
      await axios.post(
        `${config.controlBackendUrl}/api/internal/gateway/events`,
        {
          session_id: session.id,
          meeting_session_id: session.meeting_session_id,
          user_id: session.user_id,
          status: session.status,
          meeting_id: session.meeting_id,
          joined_at: session.joined_at,
          ended_at: session.ended_at,
          error: session.error,
        },
        {
          headers: { Authorization: `Bearer ${config.internalServiceSecret}` },
          timeout: 3_000,
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SessionManager] notifyControlBackend failed session=${session.id} status=${session.status}: ${msg}`);
    }
  }
}

export const sessionManager = new SessionManager();
