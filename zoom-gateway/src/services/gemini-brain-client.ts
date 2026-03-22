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

import { once } from 'events';
import axios from 'axios';
import WebSocket from 'ws';
import { config } from '../config';
import type { CaptionEvent } from './zoom-joiner';

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
    * Creates the REST session and opens the audio WebSocket.
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

    this._openAudioSocket(sessionId, brainUrl);
  }

  /** Forward raw PCM audio (int16 array) to the Gemini audio WebSocket. */
  sendAudio(sessionId: string, int16Array: number[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const pcm = Buffer.allocUnsafe(int16Array.length * 2);
    for (let i = 0; i < int16Array.length; i++) {
      pcm.writeInt16LE(int16Array[i], i * 2);
    }

    if (session.ws?.readyState === WebSocket.OPEN && session.connected) {
      session.ws.send(pcm);
      return;
    }

    session.buffer.push(pcm);
  }

  /** Forward a deduplicated Zoom caption fragment to the brain service. */
  async sendCaption(sessionId: string, caption: CaptionEvent): Promise<void> {
    const brainUrl = config.geminiServiceUrl;
    await axios.post(
      `${brainUrl}/brain/sessions/${sessionId}/captions`,
      {
        speaker: caption.speaker,
        text: caption.text,
        elapsed_ms: caption.elapsed_ms,
      },
      {
        headers: { Authorization: `Bearer ${config.internalServiceSecret}` },
        timeout: 5_000,
      },
    );
  }

  /** Gracefully stop the brain session for the given meeting session. */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.ws) {
      const ws = session.ws;
      const waitForClose = once(ws, 'close').catch(() => undefined);

      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[GeminiBrainClient] Failed to send stop control ${sessionId}: ${msg}`);
      }

      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          ws.close();
          await Promise.race([
            waitForClose,
            new Promise((resolve) => setTimeout(resolve, 5_000)),
          ]);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[GeminiBrainClient] Failed to close audio WS ${sessionId}: ${msg}`);
      }

      this.sessions.delete(sessionId);
      return;
    }

    const brainUrl = config.geminiServiceUrl;
    try {
      await axios.post(
        `${brainUrl}/brain/sessions/${sessionId}/end`,
        {},
        {
          headers: { Authorization: `Bearer ${config.internalServiceSecret}` },
          timeout: 10_000,
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[GeminiBrainClient] Failed to end brain session ${sessionId}: ${msg}`);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _openAudioSocket(sessionId: string, brainUrl: string): void {
    const existing = this.sessions.get(sessionId);
    if (existing?.ws && existing.ws.readyState !== WebSocket.CLOSED) {
      return;
    }

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

    // Keep the connection alive — send a WebSocket ping every 30s so the
    // server-side keepalive timer (uvicorn default ~60s) never fires.
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30_000);

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
      clearInterval(pingInterval);
      console.log(
        `[GeminiBrainClient] Audio WS closed session=${sessionId} code=${code} reason=${reason}`,
      );
      session.connected = false;
      this.sessions.delete(sessionId);
    });

    ws.on('error', (err) => {
      console.warn(`[GeminiBrainClient] Audio WS error session=${sessionId}: ${err.message}`);
    });
  }
}

// Module-level singleton — one client manages all sessions
export const geminiBrainClient = new GeminiBrainClient();
