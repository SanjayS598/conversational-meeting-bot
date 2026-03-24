import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(process.cwd());
const STORAGE_DIR = path.join(ROOT_DIR, "storage");
const DB_PATH = path.join(STORAGE_DIR, "db.json");
const SAMPLES_DIR = path.join(STORAGE_DIR, "samples");
const GENERATED_AUDIO_DIR = path.join(STORAGE_DIR, "generated-audio");
const EVENTS_DIR = path.join(STORAGE_DIR, "events");

loadEnvFile(path.join(ROOT_DIR, ".env"));

const internalBackendAuthToken = requireNonEmptyEnv("INTERNAL_BACKEND_AUTH_TOKEN");

export const config = {
  port: Number(process.env.PORT || 8083),
  nodeEnv: process.env.NODE_ENV || "development",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || "",
  internalBackendAuthToken,
  controlBackendBaseUrl: process.env.CONTROL_BACKEND_BASE_URL || "",
  meetingGatewayBaseUrl: process.env.MEETING_GATEWAY_BASE_URL || "",
  defaultTtsModel: process.env.DEFAULT_TTS_MODEL || "eleven_flash_v2_5",
  defaultOutputFormat: process.env.DEFAULT_OUTPUT_FORMAT || "mp3_44100_128",
  defaultLanguageCode: process.env.DEFAULT_LANGUAGE_CODE || "en",
  maxSpeechCharacters: Number(process.env.MAX_SPEECH_CHARACTERS || 500),
  speechCooldownMs: Number(process.env.SPEECH_COOLDOWN_MS || 5000),
  paths: {
    root: ROOT_DIR,
    storage: STORAGE_DIR,
    db: DB_PATH,
    samples: SAMPLES_DIR,
    generatedAudio: GENERATED_AUDIO_DIR,
    events: EVENTS_DIR
  }
};

function requireNonEmptyEnv(key) {
  const value = (process.env[key] || "").trim();
  if (!value) {
    throw new Error(`Missing required non-empty env var: ${key}`);
  }
  return value;
}

export function ensureStorageLayout() {
  for (const dir of Object.values(config.paths)) {
    if (path.extname(dir)) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      continue;
    }

    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(config.paths.db)) {
    fs.writeFileSync(
      config.paths.db,
      JSON.stringify(
        {
          voiceProfiles: [],
          speechJobs: [],
          runtimeStates: {},
          agentEvents: []
        },
        null,
        2
      )
    );
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
