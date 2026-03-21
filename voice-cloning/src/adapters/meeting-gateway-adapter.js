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
    const payload = {
      session_id: sessionId,
      job_id: jobId,
      audio_ref: audioRef,
      content_type: contentType,
      duration_ms: durationMs,
      priority,
      delivered_at: nowIso()
    };

    if (config.meetingGatewayBaseUrl) {
      try {
        await fetch(`${config.meetingGatewayBaseUrl}/internal/sessions/${sessionId}/audio-out`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.internalBackendAuthToken}`
          },
          body: JSON.stringify(payload)
        });
        return { transport: "http", accepted: true };
      } catch {
        return this.writeLocalFallback(payload);
      }
    }

    return this.writeLocalFallback(payload);
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
