/**
 * GeminiBrainClient — connects zoom-gateway to the Gemini Intelligence Service.
 *
 * Flow per session:
 *  1. POST /brain/sessions/:id/start   → create brain session
 *  2. WS   /brain/sessions/:id/audio   → stream raw PCM chunks
 *  3. On session end, send stop control message and close WS
 *
 * Audio format: raw 16-bit PCM, 16 kHz, mono (LINEAR16)
 */

import axios from 'axios';
import WebSocket from 'ws';
import { config } from '../config';

interface BrainSession {
  sessionId: string;
  ws: WebSocket | null;
  buffer: Buffer[];
  connected: boolean;
}

export class GeminiBrainClient {
  private readonly sessions = new Map<string, BrainSession>();

  /**
   * Start a Gemini brain session for the given meeting session.
   * Creates the REST session then opens the audio WebSocket.
   */
  async startSession(
    sessionId: string,
    opts: {
      meetingObjective?: string;
      prepNotes?: string;
      voiceProfileId?: string;
    } = {},
  ): Promise<void> {
    const brainUrl = config.geminiServiceUrl;

    // Create the brain session via REST
    try {
      await axios.post(
        `${brainUrl}/brain/sessions/${sessionId}/start`,
        {
          meeting_objective: opts.meetingObjective ?? 'Attend and take notes for this meeting',
          prep_notes: opts.prepNotes ?? '',
          mode: 'notes_only',
          voice_profile_id: opts.voiceProfileId ?? null,
        },
        {
          headers: { Authorization: `Bearer ${config.internalServiceSecret}` },
          timeout: 10_000,
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[GeminiBrainClient] Failed to create brain session ${sessionId}: ${msg}`);
      // Non-fatal — audio won't be transcribed but meeting join continues
      return;
    }

    // Open audio WebSocket
    this._openAudioSocket(sessionId, brainUrl);
  }

  /** Forward raw PCM audio (int16 array) to the Gemini audio WebSocket. */
  sendAudio(sessionId: string, int16Array: number[]): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    // Pack int16 values into a Buffer (little-endian)
    const buf = Buffer.allocUnsafe(int16Array.length * 2);
    for (let i = 0; i < int16Array.length; i++) {
      buf.writeInt16LE(int16Array[i], i * 2);
    }

    if (s.connected && s.ws?.readyState === WebSocket.OPEN) {
      s.ws.send(buf);
    } else {
      // Buffer while connecting
      s.buffer.push(buf);
    }
  }

  /** Gracefully stop the brain session for the given meeting session. */
  async stopSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    this.sessions.delete(sessionId);

    if (!s.ws) {
      return;
    }

    if (s.ws.readyState === WebSocket.OPEN) {
      try {
        const closed = new Promise<void>((resolve) => {
          const finish = () => resolve();
          s.ws?.once('close', finish);
          setTimeout(finish, 3_000);
        });
        s.ws.send(JSON.stringify({ type: 'stop' }));
        s.ws.close();
        await closed;
      } catch {
        // Ignore close errors
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _openAudioSocket(sessionId: string, brainUrl: string): void {
    const wsUrl = brainUrl
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:');
    const token = encodeURIComponent(config.internalServiceSecret);
    const url = `${wsUrl}/brain/sessions/${sessionId}/audio?token=${token}`;

    const session: BrainSession = {
      sessionId,
      ws: null,
      buffer: [],
      connected: false,
    };
    this.sessions.set(sessionId, session);

    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${config.internalServiceSecret}` },
    });
    session.ws = ws;

    ws.on('open', () => {
      session.connected = true;
      console.log(`[GeminiBrainClient] Audio WS connected session=${sessionId}`);

      // Flush buffered chunks
      for (const buf of session.buffer) {
        if (ws.readyState === WebSocket.OPEN) ws.send(buf);
      }
      session.buffer = [];
    });

    ws.on('close', (code, reason) => {
      console.log(
        `[GeminiBrainClient] Audio WS closed session=${sessionId} code=${code} reason=${reason}`,
      );
      session.connected = false;
    });

    ws.on('error', (err) => {
      console.warn(`[GeminiBrainClient] Audio WS error session=${sessionId}: ${err.message}`);
    });
  }
}

// Module-level singleton — one client manages all sessions
export const geminiBrainClient = new GeminiBrainClient();
