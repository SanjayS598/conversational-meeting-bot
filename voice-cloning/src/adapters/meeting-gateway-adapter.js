import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { createId, nowIso } from "../utils.js";

export class MeetingGatewayAdapter {
  async deliverSpeech({
    sessionId,
    jobId,
    audioRef,
    contentType,
    durationMs,
    priority
  }) {
    if (config.meetingGatewayBaseUrl) {
      try {
        return await this._deliverViaWebSocket({
          sessionId,
          jobId,
          audioRef,
          contentType,
          durationMs
        });
      } catch (err) {
        console.error(`[MeetingGatewayAdapter] WebSocket delivery failed for ${sessionId}:`, err.message);
        return this.writeLocalFallback({ sessionId, jobId, audioRef, contentType, durationMs, priority });
      }
    }

    return this.writeLocalFallback({ sessionId, jobId, audioRef, contentType, durationMs, priority });
  }

  async _deliverViaWebSocket({ sessionId, jobId, audioRef, contentType, durationMs }) {
    // Convert http:// base URL to ws:// for WebSocket connection
    const wsBase = config.meetingGatewayBaseUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:");
    const token = config.internalBackendAuthToken;
    const url = `${wsBase}/sessions/${sessionId}/audio-out?token=${encodeURIComponent(token)}`;

    const audioData = fs.readFileSync(audioRef);

    // Node.js >=22 has native WebSocket support
    return new Promise((resolve, reject) => {
      const ws = new globalThis.WebSocket(url);
      ws.binaryType = "nodebuffer";
      const timeoutHandle = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket delivery timed out"));
      }, 10_000);

      ws.addEventListener("open", () => {
        ws.send(audioData);
        clearTimeout(timeoutHandle);
        ws.close();
        resolve({ transport: "websocket", accepted: true });
      });

      ws.addEventListener("error", (event) => {
        clearTimeout(timeoutHandle);
        reject(new Error(event.message || "WebSocket error"));
      });
    });
  }

  writeLocalFallback(payload) {
    const filePath = path.join(config.paths.events, `${createId("playback")}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          type: "meeting_gateway_placeholder_delivery",
          payload
        },
        null,
        2
      )
    );

    return { transport: "local-fallback", accepted: true, filePath };
  }
}

