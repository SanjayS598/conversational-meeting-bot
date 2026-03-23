import dotenv from 'dotenv';
dotenv.config();

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port: parseInt(env('PORT', '3001'), 10),
  headless: env('HEADLESS', 'true').toLowerCase() !== 'false',
  internalServiceSecret: env('INTERNAL_SERVICE_SECRET', ''),
  geminiServiceUrl: env('GEMINI_SERVICE_URL', 'http://localhost:3002'),
  controlBackendUrl: env('CONTROL_BACKEND_URL', 'http://localhost:3000'),
  voiceServiceUrl: env('VOICE_SERVICE_URL', 'http://localhost:8083'),
  botDisplayName: env('BOT_DISPLAY_NAME', 'AI Assistant'),
  maxConcurrentSessions: parseInt(env('MAX_CONCURRENT_SESSIONS', '3'), 10),
  nodeEnv: env('NODE_ENV', 'development'),
  // Recall.ai cloud bot
  recallApiKey: env('RECALL_API_KEY', ''),
  recallRegion: env('RECALL_REGION', 'us-west-2'),
  recallWebhookUrl: env('RECALL_WEBHOOK_URL', ''),
};