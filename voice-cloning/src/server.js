import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { config, ensureStorageLayout } from "./config.js";
import { ControlBackendAdapter } from "./adapters/control-backend-adapter.js";
import { MeetingGatewayAdapter } from "./adapters/meeting-gateway-adapter.js";
import { ElevenLabsProvider } from "./providers/elevenlabs-provider.js";
import { RuntimeService } from "./services/runtime-service.js";
import { VoiceProfileService } from "./services/voice-profile-service.js";
import { JsonStore } from "./store.js";
import { httpError, parseJsonBody, sendBinary, sendJson } from "./utils.js";

ensureStorageLayout();

const store = new JsonStore();
const provider = new ElevenLabsProvider();
const controlBackend = new ControlBackendAdapter();
const meetingGateway = new MeetingGatewayAdapter();
const voiceProfileService = new VoiceProfileService(store, provider, controlBackend);
const runtimeService = new RuntimeService(
  store,
  provider,
  voiceProfileService,
  controlBackend,
  meetingGateway
);

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      throw httpError(400, "Malformed request.");
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "voice-cloning",
        mode: provider.enabled ? "live-elevenlabs" : "mock",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!authorize(req)) {
      throw httpError(401, "Missing or invalid Authorization header.");
    }

    if (req.method === "GET" && pathname === "/voices") {
      sendJson(res, 200, { items: voiceProfileService.listProfiles() });
      return;
    }

    if (req.method === "POST" && pathname === "/voices/enroll") {
      const body = await parseJsonBody(req);
      const profile = voiceProfileService.createEnrollment(body);
      sendJson(res, 201, profile);
      return;
    }

    const voiceMatch = pathname.match(/^\/voices\/([^/]+)$/);
    if (req.method === "GET" && voiceMatch) {
      const profile = voiceProfileService.getProfile(voiceMatch[1]);
      sendJson(res, 200, profile);
      return;
    }

    const sampleMatch = pathname.match(/^\/voices\/([^/]+)\/sample$/);
    if (req.method === "POST" && sampleMatch) {
      const body = await parseJsonBody(req);
      const profile = voiceProfileService.addSample(sampleMatch[1], body);
      sendJson(res, 201, profile);
      return;
    }

    const finalizeMatch = pathname.match(/^\/voices\/([^/]+)\/finalize$/);
    if (req.method === "POST" && finalizeMatch) {
      const profile = await voiceProfileService.finalize(finalizeMatch[1]);
      sendJson(res, 200, profile);
      return;
    }

    if (req.method === "POST" && pathname === "/voices/preview") {
      const body = await parseJsonBody(req);
      const preview = await runtimeService.previewSpeech(body);
      sendJson(res, 200, preview);
      return;
    }

    const speakMatch = pathname.match(/^\/runtime\/sessions\/([^/]+)\/speak$/);
    if (req.method === "POST" && speakMatch) {
      const body = await parseJsonBody(req);
      const job = await runtimeService.enqueueSpeech(speakMatch[1], body);
      sendJson(res, 202, job);
      return;
    }

    const cancelMatch = pathname.match(/^\/runtime\/sessions\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelMatch) {
      const body = await parseJsonBody(req);
      const result = await runtimeService.cancelSpeech(cancelMatch[1], body);
      sendJson(res, 200, result);
      return;
    }

    const stateMatch = pathname.match(/^\/runtime\/sessions\/([^/]+)\/state$/);
    if (req.method === "GET" && stateMatch) {
      const state = runtimeService.getState(stateMatch[1]);
      sendJson(res, 200, state);
      return;
    }

    const audioMatch = pathname.match(/^\/audio\/([^/]+)$/);
    if (req.method === "GET" && audioMatch) {
      const requested = audioMatch[1];
      const audioPath = path.join(config.paths.generatedAudio, requested);
      if (!fs.existsSync(audioPath)) {
        throw httpError(404, "Audio file not found.");
      }

      const buffer = fs.readFileSync(audioPath);
      const contentType = audioPath.endsWith(".json") ? "application/json" : "audio/mpeg";
      sendBinary(res, 200, buffer, contentType, requested);
      return;
    }

    throw httpError(404, `Route not found: ${req.method} ${pathname}`);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, {
      error: error.message || "Unexpected server error.",
      details: error.details || null
    });
  }
});

server.listen(config.port, () => {
  console.log(
    JSON.stringify(
      {
        service: "voice-cloning",
        port: config.port,
        mode: provider.enabled ? "live-elevenlabs" : "mock"
      },
      null,
      2
    )
  );
});

function authorize(req) {
  if (!config.internalBackendAuthToken) {
    return true;
  }

  const header = req.headers.authorization || "";
  return header === `Bearer ${config.internalBackendAuthToken}`;
}
