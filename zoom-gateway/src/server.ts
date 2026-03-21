import http from 'http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { config } from './config';
import { isValidWsToken } from './middleware/auth';
import sessionsRouter from './routes/sessions';
import testUiRouter from './routes/test-ui';
import { sessionManager } from './services/session-manager';

export function createServer(): http.Server {
  const app = express();
  app.use(express.json());

  // ── REST routes ───────────────────────────────────────────────────────────

  // Health check — no auth required, used by orchestrators and load balancers
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      active_sessions: sessionManager.listSessions().length,
      max_sessions: config.maxConcurrentSessions,
    });
  });

  app.use('/sessions', sessionsRouter);

  // Dev-only test UI — never expose in production
  if (config.nodeEnv !== 'production') {
    app.use('/test', testUiRouter);
  }

  // ── WebSocket routes ──────────────────────────────────────────────────────
  //
  //   WS /sessions/:id/audio-in   — Gemini connects here to receive raw PCM
  //                                  audio captured from the meeting.
  //                                  Gateway writes; Gemini reads.
  //
  //   WS /sessions/:id/audio-out  — ElevenLabs / Control Backend connects here
  //                                  to push synthesised speech into the meeting.
  //                                  Upstream writes; Gateway reads.
  //
  // Auth: ?token=<INTERNAL_SERVICE_SECRET> query param on upgrade request.

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const rawUrl = req.url ?? '';

    // Parse token from query string (safe: never log the value)
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl, 'http://localhost');
    } catch {
      ws.close(1008, 'Bad URL');
      return;
    }

    if (!isValidWsToken(parsedUrl.searchParams.get('token'))) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    const matchIn = rawUrl.match(/^\/sessions\/([^/?]+)\/audio-in/);
    const matchOut = rawUrl.match(/^\/sessions\/([^/?]+)\/audio-out/);

    if (matchIn) {
      const sessionId = matchIn[1];
      sessionManager.subscribeAudioIn(sessionId, ws);
      ws.send(JSON.stringify({ type: 'connected', session_id: sessionId, channel: 'audio-in' }));
      return;
    }

    if (matchOut) {
      const sessionId = matchOut[1];
      ws.send(JSON.stringify({ type: 'connected', session_id: sessionId, channel: 'audio-out' }));

      ws.on('message', (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        sessionManager.receiveAudioOut(sessionId, buf).catch((err: unknown) => {
          console.error(`[server] audio-out inject error for ${sessionId}:`, err);
        });
      });
      return;
    }

    ws.close(1008, 'Unknown path — use /sessions/:id/audio-in or /sessions/:id/audio-out');
  });

  return server;
}
