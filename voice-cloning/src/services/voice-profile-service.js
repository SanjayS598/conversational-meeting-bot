import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { createId, httpError, nowIso, requireFields, sanitizeFilename } from "../utils.js";

export class VoiceProfileService {
  constructor(store, provider, controlBackend) {
    this.store = store;
    this.provider = provider;
    this.controlBackend = controlBackend;
  }

  createEnrollment(input) {
    requireFields(input, ["user_id", "display_name"]);

    const profile = {
      id: input.voice_profile_id || createId("voice"),
      user_id: input.user_id,
      provider: "elevenlabs",
      provider_voice_id: null,
      display_name: input.display_name,
      description: input.description || "",
      labels: input.labels || {},
      status: "pending_samples",
      sample_count: 0,
      consent_confirmed: Boolean(input.consent_confirmed),
      remove_background_noise: Boolean(input.remove_background_noise),
      created_at: nowIso(),
      updated_at: nowIso(),
      sample_files: [],
      requires_verification: false
    };

    this.store.mutate((db) => {
      db.voiceProfiles.push(profile);
      return db;
    });

    void this.controlBackend.emit("voice.enrollment_created", profile);

    return profile;
  }

  getProfile(profileId) {
    return this.#getProfileOrThrow(profileId);
  }

  addSample(profileId, input) {
    requireFields(input, ["sample_name", "audio_base64"]);
    const profile = this.#getProfileOrThrow(profileId);

    const sampleId = createId("sample");
    const sampleDirectory = path.join(config.paths.samples, profileId);
    fs.mkdirSync(sampleDirectory, { recursive: true });

    const safeName = sanitizeFilename(input.sample_name);
    const extension = path.extname(safeName) || ".mp3";
    const filePath = path.join(sampleDirectory, `${sampleId}${extension}`);
    const fileBuffer = Buffer.from(input.audio_base64, "base64");
    fs.writeFileSync(filePath, fileBuffer);

    const sampleRecord = {
      id: sampleId,
      file_path: filePath,
      original_name: safeName,
      mime_type: input.mime_type || "audio/mpeg",
      notes: input.notes || "",
      created_at: nowIso()
    };

    this.store.mutate((db) => {
      const target = db.voiceProfiles.find((item) => item.id === profileId);
      target.sample_files.push(sampleRecord);
      target.sample_count = target.sample_files.length;
      target.status = "pending_finalization";
      target.updated_at = nowIso();
      return db;
    });

    void this.controlBackend.emit("voice.sample_uploaded", {
      voice_profile_id: profileId,
      sample_id: sampleId,
      sample_count: profile.sample_count + 1
    });

    return this.#getProfileOrThrow(profileId);
  }

  async finalize(profileId) {
    const profile = this.#getProfileOrThrow(profileId);

    if (!profile.consent_confirmed) {
      throw httpError(400, "Voice cloning consent must be confirmed before finalization.");
    }

    if (profile.sample_count < 1) {
      throw httpError(400, "At least one voice sample is required before finalization.");
    }

    this.store.mutate((db) => {
      const target = db.voiceProfiles.find((item) => item.id === profileId);
      target.status = "processing";
      target.updated_at = nowIso();
      return db;
    });

    try {
      const latest = this.#getProfileOrThrow(profileId);
      const providerResult = await this.provider.createVoiceClone({
        profile: latest,
        sampleFiles: latest.sample_files.map((sample) => ({
          filePath: sample.file_path,
          mimeType: sample.mime_type
        })),
        removeBackgroundNoise: latest.remove_background_noise
      });

      this.store.mutate((db) => {
        const target = db.voiceProfiles.find((item) => item.id === profileId);
        target.provider_voice_id = providerResult.providerVoiceId;
        target.requires_verification = providerResult.requiresVerification;
        target.status = providerResult.requiresVerification ? "verification_required" : "ready";
        target.updated_at = nowIso();
        return db;
      });

      const finalized = this.#getProfileOrThrow(profileId);
      await this.controlBackend.emit("voice.finalized", finalized);
      return finalized;
    } catch (error) {
      this.store.mutate((db) => {
        const target = db.voiceProfiles.find((item) => item.id === profileId);
        target.status = "failed";
        target.failure_reason = error.message;
        target.updated_at = nowIso();
        return db;
      });

      await this.controlBackend.emit("voice.failed", {
        voice_profile_id: profileId,
        reason: error.message,
        details: error.details || null
      });

      throw error;
    }
  }

  listProfiles() {
    return this.store.read().voiceProfiles;
  }

  #getProfileOrThrow(profileId) {
    const profile = this.store.read().voiceProfiles.find((item) => item.id === profileId);
    if (!profile) {
      throw httpError(404, `Voice profile not found: ${profileId}`);
    }

    return profile;
  }
}
