/**
 * GeminiBrainClient — HTTP client for the Gemini Intelligence Service.
 *
 * With Recall.ai, audio is transcribed by Recall and delivered as webhook
 * events. zoom-gateway forwards transcript segments to gemini-backend via
 * HTTP instead of streaming raw PCM over a WebSocket.
 */

import axios from 'axios';
import { config } from '../config';

export class GeminiBrainClient {
  private get authHeaders() {
    return { Authorization: `Bearer ${config.internalServiceSecret}` };
  }

  async startSession(
    sessionId: string,
    opts: {
      meetingObjective?: string;
      prepNotes?: string;
      mode?: 'notes_only' | 'suggest' | 'auto_speak';
      userTone?: string;
      speakThreshold?: number;
      prepId?: string;
      botDisplayName?: string;
      voiceProfileId?: string;
      providerVoiceId?: string;
    } = {},
  ): Promise<void> {
    try {
      await axios.post(
        `${config.geminiServiceUrl}/brain/sessions/${sessionId}/start`,
        {
          meeting_objective: opts.meetingObjective ?? 'Attend and take notes for this meeting',
          prep_notes: opts.prepNotes ?? '',
          mode: opts.mode ?? 'suggest',
          user_tone: opts.userTone ?? 'professional',
          response_policy: {
            min_confidence: opts.speakThreshold ?? 0.75,
          },
          prep_id: opts.prepId ?? null,
          bot_display_name: opts.botDisplayName ?? null,
          voice_profile_id: opts.voiceProfileId ?? null,
          provider_voice_id: opts.providerVoiceId ?? null,
        },
        { headers: this.authHeaders, timeout: 15_000 },
      );
      console.log(`[GeminiBrainClient] Session started session=${sessionId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[GeminiBrainClient] startSession failed session=${sessionId}: ${msg}`);
    }
  }

  async notifyBotJoined(sessionId: string): Promise<void> {
    try {
      await axios.post(
        `${config.geminiServiceUrl}/brain/sessions/${sessionId}/bot-joined`,
        {},
        { headers: this.authHeaders, timeout: 5_000 },
      );
      console.log(`[GeminiBrainClient] notifyBotJoined session=${sessionId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[GeminiBrainClient] notifyBotJoined failed session=${sessionId}: ${msg}`);
    }
  }

  async submitTranscript(sessionId: string, text: string, speaker: string): Promise<void> {
    try {
      await axios.post(
        `${config.geminiServiceUrl}/brain/sessions/${sessionId}/transcript`,
        { text, speaker },
        { headers: this.authHeaders, timeout: 5_000 },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[GeminiBrainClient] submitTranscript failed session=${sessionId}: ${msg}`);
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    try {
      await axios.post(
        `${config.geminiServiceUrl}/brain/sessions/${sessionId}/end`,
        {},
        { headers: this.authHeaders, timeout: 15_000 },
      );
      console.log(`[GeminiBrainClient] Session ended session=${sessionId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[GeminiBrainClient] stopSession failed session=${sessionId}: ${msg}`);
    }
  }
}

export const geminiBrainClient = new GeminiBrainClient();
