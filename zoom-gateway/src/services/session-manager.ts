import axios from 'axios';
import { config } from '../config';
import { gatewayEmitter } from '../events/emitter';
import { recallClient } from './recall-client';
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
  recallBotId: string;
  botJoinedNotified?: boolean;
  transcriptionProvider?: 'recallai_streaming' | 'meeting_captions';
  joinedVia?: 'poll' | 'webhook';
  lastRecallEventAt?: Date;
  lastTranscriptAt?: Date;
  webhookMonitorTimer?: NodeJS.Timeout;
  transcriptMonitorTimer?: NodeJS.Timeout;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

class SessionManager {
  private readonly sessions = new Map<string, ActiveSession>();
  /** Reverse lookup: Recall.ai bot ID → our session ID */
  private readonly botIdToSession = new Map<string, string>();

  // ── Public API ────────────────────────────────────────────────────────────

  /** Create and asynchronously start a bot session via Recall.ai. Returns immediately. */
  async startSession(input: StartSessionInput): Promise<Session> {
    const existing = this.sessions.get(input.meeting_session_id);
    if (existing) return existing.session;

    if (this.sessions.size >= config.maxConcurrentSessions) {
      throw new Error(`Maximum concurrent sessions (${config.maxConcurrentSessions}) reached`);
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

    this.sessions.set(session.id, { session, recallBotId: '', botJoinedNotified: false });
    this.emit('session.created', session.id);

    this.doJoin(session, input).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SessionManager] Join failed for ${session.id}: ${msg}`);
      this.updateStatus(session.id, 'failed', msg);
    });

    return session;
  }

  async stopSession(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active) return; // Already gone — idempotent

    if (active.webhookMonitorTimer) clearTimeout(active.webhookMonitorTimer);
    if (active.transcriptMonitorTimer) clearTimeout(active.transcriptMonitorTimer);

    if (active.recallBotId) {
      this.botIdToSession.delete(active.recallBotId);
      await recallClient.removeBot(active.recallBotId).catch(() => {});
    }

    active.session.ended_at = new Date();
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

  /** Map Recall.ai bot IDs back to our session IDs (used by the webhook route). */
  getSessionIdByBotId(botId: string): string | undefined {
    return this.botIdToSession.get(botId);
  }

  markJoined(botId: string, source: 'poll' | 'webhook' = 'webhook'): void {
    const sessionId = this.botIdToSession.get(botId);
    if (!sessionId) return;

    const active = this.sessions.get(sessionId);
    if (!active) return;

    active.joinedVia = source;
    active.session.joined_at ??= new Date();
    if (source === 'poll') {
      console.warn(
        `[SessionManager] Session ${sessionId} joined via polling fallback; waiting for Recall webhooks at ${config.recallWebhookUrl}/recall/events`,
      );
    }

    this.updateStatus(sessionId, 'joined');
    this.scheduleRecallDiagnostics(sessionId, botId);
  }

  recordRecallEvent(botId: string, event: string): void {
    const sessionId = this.botIdToSession.get(botId);
    if (!sessionId) return;

    const active = this.sessions.get(sessionId);
    if (!active) return;

    active.lastRecallEventAt = new Date();

    if (event === 'transcript.data' || event === 'transcript.partial_data') {
      active.lastTranscriptAt = new Date();
    }
  }

  async notifyBotJoined(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active || active.botJoinedNotified) return;

    active.botJoinedNotified = true;
    await geminiBrainClient.notifyBotJoined(sessionId).catch((err: unknown) => {
      active.botJoinedNotified = false;
      console.warn(`[SessionManager] notifyBotJoined failed session=${sessionId}:`, err);
    });
  }

  /** Receive base64-encoded MP3 from gemini-backend and speak it via Recall.ai. */
  async receiveAudioOut(sessionId: string, b64Mp3: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active?.recallBotId) return;
    await recallClient.outputAudio(active.recallBotId, b64Mp3);
  }

  async startScreenshare(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active?.recallBotId) return;
    await recallClient.outputScreenshare(active.recallBotId);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async doJoin(session: Session, input: StartSessionInput): Promise<void> {
    if (!config.recallWebhookUrl) {
      throw new Error('RECALL_WEBHOOK_URL is not set — Recall.ai needs a public URL to send events');
    }

    this.updateStatus(session.id, 'joining');
    console.log(`[SessionManager] Creating Recall.ai bot for session=${session.id} url=${session.meeting_url}`);

    const { id: botId, transcriptionProvider } = await recallClient.createBot(
      session.meeting_url,
      session.bot_display_name,
      config.recallWebhookUrl,
    );

    const active = this.sessions.get(session.id);
    if (active) {
      active.recallBotId = botId;
      active.transcriptionProvider = transcriptionProvider;
    }
    this.botIdToSession.set(botId, session.id);
    console.log(
      `[SessionManager] Recall.ai bot=${botId} session=${session.id} transcription=${transcriptionProvider} — starting brain session`,
    );

    this.pollBotStatus(session.id, botId).catch((err: unknown) => {
      console.warn(`[SessionManager] pollBotStatus failed session=${session.id}:`, err);
    });

    await geminiBrainClient.startSession(session.id, {
      meetingObjective: input.meeting_objective ?? `Take notes for meeting at ${session.meeting_url}`,
      prepNotes: input.prep_notes,
      prepId: input.prep_id,
      botDisplayName: session.bot_display_name,
      voiceProfileId: input.voice_profile_id,
      providerVoiceId: input.provider_voice_id,
    }).catch((err: unknown) => {
      console.warn(`[SessionManager] Brain start failed session=${session.id}:`, err);
    });
  }

  private async pollBotStatus(sessionId: string, botId: string): Promise<void> {
    const maxAttempts = 36;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const active = this.sessions.get(sessionId);
      if (!active || active.recallBotId !== botId) return;

      try {
        const bot = await recallClient.getBot(botId);
        const status = bot.status?.code ?? '';

        if (status === 'in_call_recording' || status === 'in_call_not_recording') {
          this.markJoined(botId, 'poll');
          await this.notifyBotJoined(sessionId);
          return;
        }

        if (status === 'done' || status === 'fatal' || status === 'call_ended') {
          await this.stopSession(sessionId);
          return;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[SessionManager] Recall bot poll attempt ${attempt + 1} failed session=${sessionId}: ${msg}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  private updateStatus(sessionId: string, status: SessionStatus, error?: string): void {
    const active = this.sessions.get(sessionId);
    if (!active) return;

    active.session.status = status;
    if (error) active.session.error = error;

    this.emit(`session.${status}` as SessionEvent['type'], sessionId, { error });
    this.notifyControlBackend(active.session);
  }

  private emit(type: SessionEvent['type'], sessionId: string, payload?: Record<string, unknown>): void {
    gatewayEmitter.emitEvent({
      type,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      payload,
    });
  }

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
          timeout: 10_000,
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SessionManager] notifyControlBackend failed session=${session.id}: ${msg}`);
    }
  }

  private scheduleRecallDiagnostics(sessionId: string, botId: string): void {
    const active = this.sessions.get(sessionId);
    if (!active) return;

    if (active.webhookMonitorTimer) clearTimeout(active.webhookMonitorTimer);
    if (active.transcriptMonitorTimer) clearTimeout(active.transcriptMonitorTimer);

    active.webhookMonitorTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (!current || current.recallBotId !== botId || current.session.status !== 'joined') return;

      if (!current.lastRecallEventAt) {
        console.error(
          `[SessionManager] No Recall webhooks received within 20s of join for session=${sessionId} bot=${botId}. RECALL_WEBHOOK_URL=${config.recallWebhookUrl}. Live transcript, notes, and follow-up replies require Recall to reach /recall/events.`,
        );
      }
    }, 20_000);

    active.transcriptMonitorTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (!current || current.recallBotId !== botId || current.session.status !== 'joined') return;

      if (!current.lastTranscriptAt && current.transcriptionProvider === 'meeting_captions') {
        console.warn(
          `[SessionManager] No transcript received within 45s for session=${sessionId} while using meeting_captions. Zoom captions may be disabled or unavailable for this meeting.`,
        );
      }
    }, 45_000);
  }
}

export const sessionManager = new SessionManager();

