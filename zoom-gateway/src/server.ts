import express from 'express';
import { createServer } from 'http';
import sessionsRouter from './routes/sessions';
import recallRouter from './routes/recall';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/sessions', sessionsRouter);
  app.use('/recall', recallRouter);

  const httpServer = createServer(app);

  return { app, httpServer };
}