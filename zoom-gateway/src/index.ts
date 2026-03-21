import { exec } from 'child_process';
import { createServer } from './server';
import { config } from './config';

const server = createServer();

server.listen(config.port, () => {
  const testUrl = `http://localhost:${config.port}/test`;
  console.log(`[ZoomGateway] Listening on port ${config.port}`);
  console.log(`[ZoomGateway] Max concurrent sessions: ${config.maxConcurrentSessions}`);
  console.log(`[ZoomGateway] Headless Chrome: ${config.headless}`);
  console.log(`[ZoomGateway] Control backend: ${config.controlBackendUrl}`);
  if (config.nodeEnv !== 'production') {
    console.log(`[ZoomGateway] Test UI → ${testUrl}`);
    exec(`open "${testUrl}"`);
  }
});

function shutdown(signal: string): void {
  console.log(`[ZoomGateway] ${signal} received — shutting down`);
  server.close(() => {
    console.log('[ZoomGateway] HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
