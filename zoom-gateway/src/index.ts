import { createApp } from './server';
import { config } from './config';

const { httpServer } = createApp();

httpServer.listen(config.port, () => {
  console.log(`[ZoomGateway] Listening on port ${config.port}`);
  console.log(`[ZoomGateway] Max concurrent sessions: ${config.maxConcurrentSessions}`);
  console.log(`[ZoomGateway] Gemini service: ${config.geminiServiceUrl}`);
  console.log(`[ZoomGateway] Control backend: ${config.controlBackendUrl}`);
  console.log(`[ZoomGateway] Recall region: ${config.recallRegion}`);
  console.log(`[ZoomGateway] Recall webhook: ${config.recallWebhookUrl || 'not set'}`);
});