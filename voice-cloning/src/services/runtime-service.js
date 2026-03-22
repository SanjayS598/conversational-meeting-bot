import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import {
  compareByPriorityThenTime,
  createId,
  httpError,
  nowIso,
  requireFields
} from "../utils.js";

export class RuntimeService {
  constructor(store, provider, voiceProfileService, controlBackend, meetingGateway) {
    this.store = store;
    this.provider = provider;
    this.voiceProfileService = voiceProfileService;
    this.controlBackend = controlBackend;
    this.meetingGateway = meetingGateway;
    this.activeControllers = new Map();
  }

  getState(sessionId) {
    const db = this.store.read();
    const runtimeState = db.runtimeStates[sessionId] || this.#buildDefaultRuntimeState(sessionId);
    const queue = db.speechJobs
      .filter((job) => job.session_id === sessionId && ["queued", "synthesizing"].includes(job.state))
      .sort(compareByPriorityThenTime);

    return {
      ...runtimeState,
      queue_depth: queue.length,
      queued_jobs: queue
    };
  }

  getJob(jobId) {
    const job = this.store.read().speechJobs.find((item) => item.job_id === jobId);
    if (!job) {
      throw httpError(404, `Speech job not found: ${jobId}`);
    }

    return job;
  }

  async previewSpeech(input) {
    requireFields(input, ["text"]);
    const profile = input.voice_profile_id
      ? this.voiceProfileService.getProfile(input.voice_profile_id)
      : null;
    const providerVoiceId = input.provider_voice_id || profile?.provider_voice_id;

    const speech = await this.provider.synthesizeSpeech({
      text: input.text,
      providerVoiceId,
      outputFormat: input.output_format || config.defaultOutputFormat,
      modelId: input.model_id || config.defaultTtsModel,
      languageCode: input.language_code || config.defaultLanguageCode,
      voiceSettings: input.voice_settings || null
    });

    const previewId = createId("preview");
    const extension = speech.contentType.includes("json") ? ".json" : ".mp3";
    const filePath = path.join(config.paths.generatedAudio, `${previewId}${extension}`);
    fs.writeFileSync(filePath, speech.buffer);

    return {
      preview_id: previewId,
      provider_mode: speech.providerMode,
      content_type: speech.contentType,
      duration_ms: speech.durationMs,
      audio_ref: filePath
    };
  }

  async enqueueSpeech(sessionId, input) {
    requireFields(input, ["voice_profile_id", "text"]);

    if (input.text.length > config.maxSpeechCharacters) {
      throw httpError(
        400,
        `Speech text exceeds MAX_SPEECH_CHARACTERS (${config.maxSpeechCharacters}).`
      );
    }

    const profile = this.voiceProfileService.getProfile(input.voice_profile_id);
    if (!profile.provider_voice_id) {
      throw httpError(400, "Voice profile has not been finalized with ElevenLabs yet.");
    }

    if (!["ready", "verification_required"].includes(profile.status)) {
      throw httpError(400, `Voice profile is not ready for speech generation. Status: ${profile.status}`);
    }

    const createdAt = nowIso();
    const job = {
      job_id: createId("speech"),
      session_id: sessionId,
      voice_profile_id: input.voice_profile_id,
      text: input.text,
      priority: Number(input.priority || 0),
      urgent: Boolean(input.urgent),
      state: "queued",
      audio_ref: null,
      error: null,
      content_type: null,
      provider_request_id: null,
      created_at: createdAt,
      updated_at: createdAt,
      telemetry: {
        text_received_at: createdAt,
        synthesis_started_at: null,
        synthesis_completed_at: null,
        playback_sent_at: null,
        playback_ended_at: null
      }
    };

    this.store.mutate((db) => {
      db.speechJobs.push(job);
      db.runtimeStates[sessionId] = this.#upsertState(db.runtimeStates[sessionId], sessionId, {
        queue_depth: this.#getQueueDepth(db, sessionId) + 1
      });
      return db;
    });

    await this.controlBackend.emit("speech.queued", job);
    void this.#processQueue(sessionId);

    return job;
  }

  async enqueueSpeechForUser(sessionId, input) {
    requireFields(input, ["user_id", "text"]);
    const profile = this.voiceProfileService.getDefaultReadyProfileForUser(input.user_id);

    return this.enqueueSpeech(sessionId, {
      ...input,
      voice_profile_id: profile.id
    });
  }

  async cancelSpeech(sessionId, input = {}) {
    const runtimeState = this.getState(sessionId);
    const db = this.store.read();
    const firstQueuedJob = db.speechJobs
      .filter((job) => job.session_id === sessionId && job.state === "queued")
      .sort(compareByPriorityThenTime)[0];
    const targetJobId = input.job_id || runtimeState.active_job_id || firstQueuedJob?.job_id;
    const queuedJob = db.speechJobs.find(
      (job) => job.session_id === sessionId && job.job_id === targetJobId && job.state === "queued"
    );

    if (queuedJob) {
      this.store.mutate((draft) => {
        const target = draft.speechJobs.find((job) => job.job_id === targetJobId);
        target.state = "canceled";
        target.updated_at = nowIso();
        target.error = input.reason || "Canceled before synthesis.";
        return draft;
      });

      await this.controlBackend.emit("speech.canceled", {
        session_id: sessionId,
        job_id: targetJobId,
        reason: input.reason || "Canceled before synthesis."
      });

      return { canceled: true, job_id: targetJobId, state: "canceled" };
    }

    const activeController = this.activeControllers.get(sessionId);
    if (activeController && targetJobId) {
      activeController.abort();
      this.store.mutate((draft) => {
        const target = draft.speechJobs.find((job) => job.job_id === targetJobId);
        if (target) {
          target.state = "interrupted";
          target.updated_at = nowIso();
          target.error = input.reason || "Playback interrupted.";
        }

        draft.runtimeStates[sessionId] = this.#upsertState(draft.runtimeStates[sessionId], sessionId, {
          active_job_id: null,
          is_playing: false,
          last_interrupt_at: nowIso()
        });

        return draft;
      });

      await this.controlBackend.emit("speech.interrupted", {
        session_id: sessionId,
        job_id: targetJobId,
        reason: input.reason || "Playback interrupted."
      });

      return { canceled: true, job_id: targetJobId, state: "interrupted" };
    }

    return { canceled: false, reason: "No matching queued or active speech job found." };
  }

  async #processQueue(sessionId) {
    const state = this.getState(sessionId);
    if (state.is_playing) {
      return;
    }

    const db = this.store.read();
    const queuedJob = db.speechJobs
      .filter((job) => job.session_id === sessionId && job.state === "queued")
      .sort(compareByPriorityThenTime)[0];

    if (!queuedJob) {
      return;
    }

    const runtimeState = db.runtimeStates[sessionId] || this.#buildDefaultRuntimeState(sessionId);
    const lastSpoken = runtimeState.last_playback_ended_at
      ? new Date(runtimeState.last_playback_ended_at).getTime()
      : 0;
    const cooldownRemaining = config.speechCooldownMs - (Date.now() - lastSpoken);

    if (cooldownRemaining > 0 && !queuedJob.urgent) {
      setTimeout(() => {
        void this.#processQueue(sessionId);
      }, cooldownRemaining);
      return;
    }

    const controller = new AbortController();
    this.activeControllers.set(sessionId, controller);

    try {
      this.store.mutate((draft) => {
        const target = draft.speechJobs.find((job) => job.job_id === queuedJob.job_id);
        target.state = "synthesizing";
        target.updated_at = nowIso();
        target.telemetry.synthesis_started_at = nowIso();
        draft.runtimeStates[sessionId] = this.#upsertState(draft.runtimeStates[sessionId], sessionId, {
          active_job_id: queuedJob.job_id,
          is_playing: true
        });
        return draft;
      });

      await this.controlBackend.emit("speech.started", {
        session_id: sessionId,
        job_id: queuedJob.job_id
      });

      const profile = this.voiceProfileService.getProfile(queuedJob.voice_profile_id);
      const speech = await this.provider.synthesizeSpeech({
        text: queuedJob.text,
        providerVoiceId: profile.provider_voice_id,
        outputFormat: config.defaultOutputFormat,
        modelId: config.defaultTtsModel,
        languageCode: config.defaultLanguageCode,
        voiceSettings: null,
        signal: controller.signal
      });

      if (controller.signal.aborted) {
        return;
      }

      const fileExtension = speech.contentType.includes("json") ? ".json" : ".mp3";
      const audioPath = path.join(config.paths.generatedAudio, `${queuedJob.job_id}${fileExtension}`);
      fs.writeFileSync(audioPath, speech.buffer);

      const playbackResult = await this.meetingGateway.deliverSpeech({
        sessionId,
        jobId: queuedJob.job_id,
        audioRef: audioPath,
        contentType: speech.contentType,
        durationMs: speech.durationMs,
        priority: queuedJob.priority
      });

      this.store.mutate((draft) => {
        const target = draft.speechJobs.find((job) => job.job_id === queuedJob.job_id);
        target.state = "completed";
        target.audio_ref = audioPath;
        target.content_type = speech.contentType;
        target.provider_request_id = speech.requestId;
        target.updated_at = nowIso();
        target.telemetry.synthesis_completed_at = nowIso();
        target.telemetry.playback_sent_at = nowIso();
        target.telemetry.playback_ended_at = nowIso();

        draft.runtimeStates[sessionId] = this.#upsertState(draft.runtimeStates[sessionId], sessionId, {
          active_job_id: null,
          is_playing: false,
          last_playback_ended_at: nowIso(),
          last_delivery_transport: playbackResult.transport
        });

        return draft;
      });

      await this.controlBackend.emit("speech.completed", {
        session_id: sessionId,
        job_id: queuedJob.job_id,
        audio_ref: audioPath,
        playback_transport: playbackResult.transport
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        this.store.mutate((draft) => {
          const target = draft.speechJobs.find((job) => job.job_id === queuedJob.job_id);
          target.state = "failed";
          target.error = error.message;
          target.updated_at = nowIso();
          draft.runtimeStates[sessionId] = this.#upsertState(draft.runtimeStates[sessionId], sessionId, {
            active_job_id: null,
            is_playing: false
          });
          return draft;
        });

        await this.controlBackend.emit("speech.failed", {
          session_id: sessionId,
          job_id: queuedJob.job_id,
          reason: error.message,
          details: error.details || null
        });
      }
    } finally {
      this.activeControllers.delete(sessionId);
      setImmediate(() => {
        void this.#processQueue(sessionId);
      });
    }
  }

  #getQueueDepth(db, sessionId) {
    return db.speechJobs.filter((job) => job.session_id === sessionId && job.state === "queued").length;
  }

  #buildDefaultRuntimeState(sessionId) {
    return {
      session_id: sessionId,
      active_job_id: null,
      queue_depth: 0,
      is_playing: false,
      last_interrupt_at: null,
      last_playback_ended_at: null,
      last_delivery_transport: null
    };
  }

  #upsertState(existingState, sessionId, patch) {
    return {
      ...this.#buildDefaultRuntimeState(sessionId),
      ...(existingState || {}),
      ...patch,
      queue_depth: 0
    };
  }
}
