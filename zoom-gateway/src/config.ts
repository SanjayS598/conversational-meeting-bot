import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  internalServiceSecret: required('INTERNAL_SERVICE_SECRET'),
  geminiServiceUrl: process.env.GEMINI_SERVICE_URL ?? 'http://localhost:3002',
  voiceServiceUrl: process.env.VOICE_SERVICE_URL ?? 'http://localhost:3003',
  controlBackendUrl: process.env.CONTROL_BACKEND_URL ?? 'http://localhost:3000',
  botDisplayName: process.env.BOT_DISPLAY_NAME ?? 'AI Assistant',
  maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS ?? '3', 10),
  headless: process.env.HEADLESS !== 'false',
  nodeEnv: process.env.NODE_ENV ?? 'development',
} as const;
