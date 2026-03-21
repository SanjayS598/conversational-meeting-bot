import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { nowIso } from "../utils.js";

export class ControlBackendAdapter {
  async emit(eventType, payload) {
    if (config.controlBackendBaseUrl) {
      try {
        await fetch(`${config.controlBackendBaseUrl}/api/internal/voice-events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.internalBackendAuthToken}`
          },
          body: JSON.stringify({
            event_type: eventType,
            payload,
            created_at: nowIso()
          })
        });
      } catch {
        await this.writeLocalFallback(eventType, payload);
      }

      return;
    }

    await this.writeLocalFallback(eventType, payload);
  }

  async writeLocalFallback(eventType, payload) {
    const eventId = `${Date.now()}_${eventType.replace(/[^a-z0-9_-]/gi, "_")}.json`;
    const filePath = path.join(config.paths.events, eventId);
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          event_type: eventType,
          payload,
          created_at: nowIso(),
          transport: "local-fallback"
        },
        null,
        2
      )
    );
  }
}
