import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { createId, estimateSpeechDurationMs, httpError } from "../utils.js";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";

export class ElevenLabsProvider {
  constructor() {
    this.enabled = Boolean(config.elevenLabsApiKey);
  }

  async createVoiceClone({ profile, sampleFiles, removeBackgroundNoise }) {
    if (!this.enabled) {
      return {
        providerVoiceId: `mock_voice_${profile.id}`,
        requiresVerification: false,
        providerMode: "mock"
      };
    }

    const formData = new FormData();
    formData.append("name", profile.display_name);

    if (profile.description) {
      formData.append("description", profile.description);
    }

    if (profile.labels && Object.keys(profile.labels).length > 0) {
      formData.append("labels", JSON.stringify(profile.labels));
    }

    formData.append("remove_background_noise", String(Boolean(removeBackgroundNoise)));

    for (const file of sampleFiles) {
      const fileBuffer = fs.readFileSync(file.filePath);
      formData.append(
        "files",
        new Blob([fileBuffer], { type: file.mimeType || "audio/mpeg" }),
        path.basename(file.filePath)
      );
    }

    const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/voices/add`, {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsApiKey
      },
      body: formData
    });

    if (!response.ok) {
      const text = await response.text();
      throw httpError(502, "ElevenLabs voice clone request failed.", {
        providerStatus: response.status,
        providerBody: text
      });
    }

    const data = await response.json();
    return {
      providerVoiceId: data.voice_id,
      requiresVerification: Boolean(data.requires_verification),
      providerMode: "live"
    };
  }

  async synthesizeSpeech({
    text,
    providerVoiceId,
    outputFormat,
    modelId,
    languageCode,
    voiceSettings,
    signal
  }) {
    if (!providerVoiceId) {
      throw httpError(400, "A provider voice ID is required before speech synthesis can start.");
    }

    if (!this.enabled) {
      const fakeAudio = Buffer.from(
        JSON.stringify(
          {
            mock: true,
            voice_id: providerVoiceId,
            text,
            generated_at: new Date().toISOString()
          },
          null,
          2
        ),
        "utf8"
      );

      return {
        requestId: createId("mock_req"),
        contentType: "application/json",
        buffer: fakeAudio,
        durationMs: estimateSpeechDurationMs(text),
        providerMode: "mock"
      };
    }

    const query = new URLSearchParams({
      output_format: outputFormat,
      enable_logging: "true"
    });

    const response = await fetch(
      `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${providerVoiceId}?${query.toString()}`,
      {
        method: "POST",
        signal,
        headers: {
          "xi-api-key": config.elevenLabsApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          language_code: languageCode || undefined,
          voice_settings: voiceSettings || undefined
        })
      }
    );

    if (!response.ok) {
      const textBody = await response.text();
      throw httpError(502, "ElevenLabs speech generation failed.", {
        providerStatus: response.status,
        providerBody: textBody
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const requestId = response.headers.get("request-id") || createId("live_req");

    return {
      requestId,
      contentType,
      buffer: Buffer.from(arrayBuffer),
      durationMs: estimateSpeechDurationMs(text),
      providerMode: "live"
    };
  }
}
