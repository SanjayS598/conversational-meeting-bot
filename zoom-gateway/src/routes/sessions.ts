import { Router } from 'express';
import { sessionManager } from '../services/session-manager';
import { requireInternalAuth } from '../middleware/auth';
import type { StartSessionInput } from '../types/index';

const router = Router();

// All session routes require the internal service token
router.use(requireInternalAuth);

// POST /sessions/start
// Body: StartSessionInput
// Returns 202 with the created Session object (status will be 'created', bot joins async)
router.post('/start', async (req, res) => {
  const { meeting_session_id, user_id, meeting_url, passcode, bot_display_name, meeting_objective, prep_notes, prep_id } =
    req.body as Partial<StartSessionInput>;

  if (!meeting_session_id || !user_id || !meeting_url) {
    res.status(400).json({
      error: 'meeting_session_id, user_id, and meeting_url are required',
    });
    return;
  }

  try {
    const session = await sessionManager.startSession({
      meeting_session_id,
      user_id,
      meeting_url,
      passcode,
      bot_display_name,
      meeting_objective,
      prep_notes,
      prep_id,
    });
    res.status(202).json(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = message.includes('Maximum concurrent') ? 429 : 500;
    res.status(status).json({ error: message });
  }
});

// POST /sessions/:id/stop
router.post('/:id/stop', async (req, res) => {
  try {
    await sessionManager.stopSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

// GET /sessions/:id/status
router.get('/:id/status', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

// GET /sessions  — list all active sessions
router.get('/', (_req, res) => {
  res.json(sessionManager.listSessions());
});

export default router;
