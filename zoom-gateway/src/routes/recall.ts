/**
 * Recall.ai webhook receiver.
 *
 * Recall.ai POSTs events to this endpoint when:
 *  - bot.status_change  → bot joined/left/failed
 *  - transcript.data / transcript.partial_data → a transcription segment is ready
 */

import { Router } from 'express';
import { sessionManager } from '../services/session-manager';
import { geminiBrainClient } from '../services/gemini-brain-client';

const router = Router();

function extractTranscriptText(event: RecallEvent): string {
  const transcript = event.data?.data?.transcript?.trim();
  if (transcript) return transcript;

  const words: Array<{ text?: string | null }> = event.data?.data?.words ?? [];
  return words
    .map((w) => (w.text ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

router.post('/events', async (req, res) => {
  // Acknowledge immediately so Recall.ai doesn't retry
  res.status(200).json({ ok: true });

  const event = req.body as RecallEvent;
  if (!event?.event || !event?.data) return;

  const botId: string = event.data?.bot?.id ?? '';

  console.log(`[RecallWebhook] event=${event.event} bot_id=${botId}`);
  sessionManager.recordRecallEvent(botId, event.event);

  if (event.event === 'bot.status_change') {
    const status: string = event.data?.bot?.status?.code ?? '';
    const sessionId = sessionManager.getSessionIdByBotId(botId);

    if (!sessionId) {
      console.warn(`[RecallWebhook] unknown bot_id=${botId} for status=${status}`);
      return;
    }

    if (status === 'in_call_recording' || status === 'in_call_not_recording') {
      console.log(`[RecallWebhook] Bot in call session=${sessionId}`);
      sessionManager.markJoined(botId, 'webhook');
      sessionManager.notifyBotJoined(sessionId).catch(console.error);
    } else if (status === 'done' || status === 'fatal' || status === 'call_ended') {
      console.log(`[RecallWebhook] Bot done session=${sessionId} status=${status}`);
      sessionManager.stopSession(sessionId).catch(console.error);
    }
  }

  if (event.event === 'transcript.data' || event.event === 'transcript.partial_data') {
    const botId2: string = event.data?.bot?.id ?? botId;
    const sessionId = sessionManager.getSessionIdByBotId(botId2);
    if (!sessionId) return;

    const text = extractTranscriptText(event);
    const speaker: string = event.data?.data?.participant?.name?.trim() || 'Participant';

    if (text) {
      console.log(`[RecallWebhook] ${event.event} session=${sessionId} speaker=${speaker} text="${text}"`);
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
      transcript?: string | null;
      words?: Array<{ text?: string | null }>;
      participant?: { name?: string | null };
    };
  };
}
