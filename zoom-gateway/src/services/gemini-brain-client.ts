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
    * Creates the REST session. Transcript ingestion happens via caption events.
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

  }

  /** Forward raw PCM audio (int16 array) to the Gemini audio WebSocket. */
  sendAudio(sessionId: string, int16Array: number[]): void {
    void sessionId;
    void int16Array;
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
    const s = this.sessions.get(sessionId);
    if (s) this.sessions.delete(sessionId);

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
    });

    ws.on('error', (err) => {
      console.warn(`[GeminiBrainClient] Audio WS error session=${sessionId}: ${err.message}`);
    });
  }
}

// Module-level singleton — one client manages all sessions
export const geminiBrainClient = new GeminiBrainClient();
