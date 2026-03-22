/**
 * Recall.ai REST API client.
 *
 * Recall.ai is a cloud bot service that joins Zoom/Meet natively without
 * needing Puppeteer or PulseAudio. Audio injection goes through their
 * output_audio API which speaks directly in the meeting.
 */

import axios from 'axios';
import { config } from '../config';

class RecallClient {
  private get base() {
    return `https://${config.recallRegion}.recall.ai/api`;
  }

  private get headers() {
    return {
      Authorization: `Token ${config.recallApiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a Recall.ai bot and have it join the meeting.
   * Transcription events and status changes are sent to webhookUrl.
   */
  async createBot(
    meetingUrl: string,
    botName: string,
    webhookUrl: string,
  ): Promise<{ id: string }> {
    const payload = {
      meeting_url: meetingUrl,
      bot_name: botName,
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              mode: 'prioritize_low_latency',
            },
          },
        },
        realtime_endpoints: [
          {
            type: 'webhook',
            url: `${webhookUrl}/recall/events`,
            events: ['transcript.data'],
          },
        ],
      },
      webhook_url: `${webhookUrl}/recall/events`,
    };

    try {
      return await this.createBotRequest(payload);
    } catch (err: unknown) {
      if (!this.shouldRetryWithMeetingCaptions(err)) {
        throw this.toCreateBotError(err);
      }

      console.warn('[RecallClient] Recall.ai streaming transcription unavailable; retrying with meeting captions');

      return this.createBotRequest({
        meeting_url: meetingUrl,
        bot_name: botName,
        recording_config: {
          transcript: {
            provider: {
              meeting_captions: {},
            },
          },
          realtime_endpoints: [
            {
              type: 'webhook',
              url: `${webhookUrl}/recall/events`,
              events: ['transcript.data'],
            },
          ],
        },
        webhook_url: `${webhookUrl}/recall/events`,
      }).catch((retryErr: unknown) => {
        throw this.toCreateBotError(retryErr);
      });
    }
  }

  /** Tell the bot to leave the meeting immediately. */
  async removeBot(botId: string): Promise<void> {
    try {
      await axios.post(
        `${this.base}/v1/bot/${botId}/leave_call`,
        {},
        { headers: this.headers, timeout: 10_000 },
      );
    } catch {
      // Best-effort — bot may have already left
    }
  }

  /**
   * Inject base64-encoded MP3 audio so the bot speaks in the meeting.
   * Uses the v2 API: POST /api/v2/bot/:id/output_audio
   */
  async outputAudio(botId: string, b64Mp3: string): Promise<void> {
    try {
      await axios.post(
        `${this.base}/v2/bot/${botId}/output_audio`,
        { kind: 'mp3', b64_data: b64Mp3 },
        { headers: this.headers, timeout: 30_000 },
      );
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const body = JSON.stringify(err.response?.data ?? {});
        console.error(`[RecallClient] outputAudio failed ${err.response?.status}: ${body}`);
      }
      throw err;
    }
  }

  async getBot(botId: string): Promise<{ id: string; status?: { code?: string } }> {
    try {
      const resp = await axios.get(`${this.base}/v1/bot/${botId}`, {
        headers: this.headers,
        timeout: 15_000,
      });
      const latestStatus = Array.isArray(resp.data?.status_changes)
        ? resp.data.status_changes[resp.data.status_changes.length - 1]
        : undefined;

      return {
        id: resp.data.id,
        status: {
          code: resp.data?.status?.code ?? latestStatus?.code,
        },
      };
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const body = JSON.stringify(err.response?.data ?? {});
        throw new Error(`Recall.ai getBot failed ${err.response?.status}: ${body}`);
      }
      throw err;
    }
  }

  private async createBotRequest(payload: Record<string, unknown>): Promise<{ id: string }> {
    const resp = await axios.post(`${this.base}/v1/bot`, payload, {
      headers: this.headers,
      timeout: 30_000,
    });
    console.log(`[RecallClient] Bot created id=${resp.data.id}`);
    return { id: resp.data.id };
  }

  private shouldRetryWithMeetingCaptions(err: unknown): boolean {
    if (!axios.isAxiosError(err)) return false;
    return err.response?.status === 400 || err.response?.status === 422;
  }

  private toCreateBotError(err: unknown): Error {
    if (axios.isAxiosError(err)) {
      const body = JSON.stringify(err.response?.data ?? {});
      return new Error(`Recall.ai createBot failed ${err.response?.status}: ${body}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

export const recallClient = new RecallClient();
