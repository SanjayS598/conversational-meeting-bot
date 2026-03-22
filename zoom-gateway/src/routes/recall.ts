/**
 * Recall.ai webhook receiver.
 *
 * Recall.ai POSTs events to this endpoint when:
 *  - bot.status_change  → bot joined/left/failed
 *  - transcript.data    → a transcription segment is ready
 */

import { Router } from 'express';
import { sessionManager } from '../services/session-manager';
import { geminiBrainClient } from '../services/gemini-brain-client';

const router = Router();

router.post('/events', async (req, res) => {
  // Acknowledge immediately so Recall.ai doesn't retry
  res.status(200).json({ ok: true });

  const event = req.body as RecallEvent;
  if (!event?.event || !event?.data) return;

  const botId: string = event.data?.bot?.id ?? '';

  console.log(`[RecallWebhook] event=${event.event} bot_id=${botId}`);

  if (event.event === 'bot.status_change') {
    const status: string = event.data?.bot?.status?.code ?? '';
    const sessionId = sessionManager.getSessionIdByBotId(botId);

    if (!sessionId) {
      console.warn(`[RecallWebhook] unknown bot_id=${botId} for status=${status}`);
      return;
    }

    if (status === 'in_call_recording' || status === 'in_call_not_recording') {
      console.log(`[RecallWebhook] Bot in call session=${sessionId}`);
      sessionManager.markJoined(botId);
      sessionManager.notifyBotJoined(sessionId).catch(console.error);
    } else if (status === 'done' || status === 'fatal' || status === 'call_ended') {
      console.log(`[RecallWebhook] Bot done session=${sessionId} status=${status}`);
      sessionManager.stopSession(sessionId).catch(console.error);
    }
  }

  if (event.event === 'transcript.data') {
    const botId2: string = event.data?.bot?.id ?? botId;
    const sessionId = sessionManager.getSessionIdByBotId(botId2);
    if (!sessionId) return;

    const words: Array<{ text: string }> = event.data?.data?.words ?? [];
    const text = words.map((w) => w.text).join(' ').trim();
    const speaker: string = event.data?.data?.participant?.name?.trim() || 'Participant';

    if (text) {
      console.log(`[RecallWebhook] transcript session=${sessionId} speaker=${speaker} text="${text}"`);
      geminiBrainClient.submitTranscript(sessionId, text, speaker).catch(console.error);
    }
  }
});

export default router;

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecallEvent {
  event: string;
  data: {
    bot?: { id: string; status?: { code: string } };
    data?: {
      words?: Array<{ text: string }>;
      participant?: { name?: string | null };
    };
  };
}
