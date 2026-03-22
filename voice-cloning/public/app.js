const state = {
  lastPreview: null,
  lastRuntimeJob: null
};

const el = {
  authToken: document.getElementById("auth-token"),
  userId: document.getElementById("user-id"),
  healthStatus: document.getElementById("health-status"),
  healthMode: document.getElementById("health-mode"),
  resetAll: document.getElementById("reset-all"),
  displayName: document.getElementById("display-name"),
  description: document.getElementById("description"),
  consentConfirmed: document.getElementById("consent-confirmed"),
  voiceList: document.getElementById("voice-list"),
  voiceProfileId: document.getElementById("voice-profile-id"),
  sampleFile: document.getElementById("sample-file"),
  voiceDetail: document.getElementById("voice-detail"),
  previewText: document.getElementById("preview-text"),
  previewAudio: document.getElementById("preview-audio"),
  previewDetail: document.getElementById("preview-detail"),
  sessionId: document.getElementById("session-id"),
  priority: document.getElementById("priority"),
  urgent: document.getElementById("urgent"),
  runtimeText: document.getElementById("runtime-text"),
  runtimeAudio: document.getElementById("runtime-audio"),
  runtimeDetail: document.getElementById("runtime-detail"),
  activityLog: document.getElementById("activity-log")
};

boot();

function boot() {
  loadLocalSettings();
  wireEvents();
  refreshHealth();
  updateButtonStates();
}

function wireEvents() {
  document.getElementById("save-settings").addEventListener("click", saveLocalSettings);
  document.getElementById("refresh-health").addEventListener("click", refreshHealth);
  el.resetAll.addEventListener("click", resetEverything);
  document.getElementById("create-voice").addEventListener("click", createVoiceProfile);
  document.getElementById("load-user-voices").addEventListener("click", loadUserVoices);
  document.getElementById("upload-sample").addEventListener("click", uploadSample);
  document.getElementById("finalize-voice").addEventListener("click", finalizeVoice);
  document.getElementById("load-default-voice").addEventListener("click", loadDefaultVoice);
  document.getElementById("generate-preview").addEventListener("click", generatePreview);
  document.getElementById("queue-speech").addEventListener("click", queueSpeech);
  document.getElementById("refresh-runtime").addEventListener("click", refreshRuntimeState);
  document.getElementById("cancel-runtime").addEventListener("click", cancelRuntime);

  [
    el.authToken,
    el.userId,
    el.displayName,
    el.voiceProfileId,
    el.sampleFile,
    el.previewText,
    el.sessionId,
    el.runtimeText
  ].forEach((element) => {
    element.addEventListener("input", updateButtonStates);
    element.addEventListener("change", updateButtonStates);
  });
}

function loadLocalSettings() {
  el.authToken.value = localStorage.getItem("voice_ui_auth_token") || "";
  el.userId.value = localStorage.getItem("voice_ui_user_id") || "demo_user_1";
  el.displayName.value = localStorage.getItem("voice_ui_display_name") || "Demo Voice";
}

function saveLocalSettings() {
  localStorage.setItem("voice_ui_auth_token", el.authToken.value.trim());
  localStorage.setItem("voice_ui_user_id", el.userId.value.trim());
  localStorage.setItem("voice_ui_display_name", el.displayName.value.trim());
  log("Saved local settings.");
  updateButtonStates();
}

async function refreshHealth() {
  const data = await request("/health", { method: "GET" }, false);
  el.healthStatus.textContent = data.ok ? "Running" : "Unavailable";
  el.healthMode.textContent = data.mode || "-";
  log(`Health check: ${data.mode}`);
}

async function createVoiceProfile() {
  const payload = {
    user_id: el.userId.value.trim(),
    display_name: el.displayName.value.trim(),
    description: el.description.value.trim(),
    consent_confirmed: el.consentConfirmed.checked
  };

  const profile = await request("/voices/enroll", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  el.voiceProfileId.value = profile.id;
  el.voiceDetail.textContent = format(profile);
  log(`Created voice profile ${profile.id}`);
  updateButtonStates();
  await loadUserVoices();
}

async function loadUserVoices() {
  const userId = el.userId.value.trim();
  const data = await request(`/users/${encodeURIComponent(userId)}/voices`, { method: "GET" });
  renderVoiceList(data.items || []);
  log(`Loaded ${data.items.length} voice profile(s) for ${userId}`);
}

async function loadDefaultVoice() {
  const userId = el.userId.value.trim();
  const profile = await request(`/users/${encodeURIComponent(userId)}/voices/default`, { method: "GET" });
  el.voiceProfileId.value = profile.id;
  el.voiceDetail.textContent = format(profile);
  log(`Loaded default voice ${profile.id}`);
  updateButtonStates();
}

async function uploadSample() {
  const file = el.sampleFile.files[0];
  if (!file) {
    throw new Error("Choose an audio file first.");
  }

  const base64 = await fileToBase64(file);
  const profileId = el.voiceProfileId.value.trim();
  const payload = {
    sample_name: file.name,
    mime_type: file.type || "application/octet-stream",
    audio_base64: base64
  };

  const profile = await request(`/voices/${encodeURIComponent(profileId)}/sample`, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  el.voiceDetail.textContent = format(profile);
  log(`Uploaded sample ${file.name} to ${profileId}`);
  updateButtonStates();
}

async function finalizeVoice() {
  const profileId = el.voiceProfileId.value.trim();
  const profile = await request(`/voices/${encodeURIComponent(profileId)}/finalize`, {
    method: "POST"
  });

  el.voiceDetail.textContent = format(profile);
  log(`Finalized voice ${profileId} with provider voice ${profile.provider_voice_id}`);
  updateButtonStates();
  await loadUserVoices();
}

async function generatePreview() {
  const payload = {
    voice_profile_id: el.voiceProfileId.value.trim(),
    text: el.previewText.value.trim()
  };

  const preview = await request("/voices/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  state.lastPreview = preview;
  el.previewAudio.src = toAudioUrl(preview.audio_ref);
  el.previewDetail.textContent = format(preview);
  log(`Generated preview ${preview.preview_id}`);
  updateButtonStates();
}

async function queueSpeech() {
  const sessionId = el.sessionId.value.trim();
  const payload = {
    user_id: el.userId.value.trim(),
    text: el.runtimeText.value.trim(),
    priority: Number(el.priority.value),
    urgent: el.urgent.checked
  };

  const job = await request(`/internal/runtime/sessions/${encodeURIComponent(sessionId)}/respond`, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  state.lastRuntimeJob = job;
  el.runtimeDetail.textContent = format(job);
  log(`Queued runtime job ${job.job_id} for session ${sessionId}`);
  updateButtonStates();
  setTimeout(refreshRuntimeState, 3000);
}

async function refreshRuntimeState() {
  const sessionId = el.sessionId.value.trim();
  const stateResponse = await request(`/runtime/sessions/${encodeURIComponent(sessionId)}/state`, {
    method: "GET"
  });

  el.runtimeDetail.textContent = format(stateResponse);
  log(`Refreshed runtime state for ${sessionId}`);

  if (state.lastRuntimeJob?.job_id) {
    const job = await request(`/runtime/jobs/${encodeURIComponent(state.lastRuntimeJob.job_id)}`, {
      method: "GET"
    });
    state.lastRuntimeJob = job;
    el.runtimeDetail.textContent = format({
      runtime_state: stateResponse,
      job
    });
    if (job.audio_ref) {
      el.runtimeAudio.src = toAudioUrl(job.audio_ref);
    }
  }

  updateButtonStates();
}

async function cancelRuntime() {
  const sessionId = el.sessionId.value.trim();
  const payload = {
    job_id: state.lastRuntimeJob?.job_id,
    reason: "Canceled from temporary UI."
  };

  const result = await request(`/runtime/sessions/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  log(`Cancel response: ${formatInline(result)}`);
  updateButtonStates();
  await refreshRuntimeState();
}

function updateButtonStates() {
  const hasToken = Boolean(el.authToken.value.trim());
  const hasUserId = Boolean(el.userId.value.trim());
  const hasDisplayName = Boolean(el.displayName.value.trim());
  const hasVoiceProfileId = Boolean(el.voiceProfileId.value.trim());
  const hasSample = Boolean(el.sampleFile.files?.length);
  const hasPreviewText = Boolean(el.previewText.value.trim());
  const hasSessionId = Boolean(el.sessionId.value.trim());
  const hasRuntimeText = Boolean(el.runtimeText.value.trim());

  byId("save-settings").disabled = !hasToken || !hasUserId;
  byId("load-user-voices").disabled = !hasToken || !hasUserId;
  byId("create-voice").disabled = !hasToken || !hasUserId || !hasDisplayName || !el.consentConfirmed.checked;
  byId("upload-sample").disabled = !hasToken || !hasVoiceProfileId || !hasSample;
  byId("finalize-voice").disabled = !hasToken || !hasVoiceProfileId;
  byId("load-default-voice").disabled = !hasToken || !hasUserId;
  byId("generate-preview").disabled = !hasToken || !hasVoiceProfileId || !hasPreviewText;
  byId("queue-speech").disabled = !hasToken || !hasUserId || !hasSessionId || !hasRuntimeText;
  byId("refresh-runtime").disabled = !hasToken || !hasSessionId;
  byId("cancel-runtime").disabled = !hasToken || !hasSessionId || !state.lastRuntimeJob?.job_id;
}

function resetEverything() {
  localStorage.removeItem("voice_ui_auth_token");
  localStorage.removeItem("voice_ui_user_id");
  localStorage.removeItem("voice_ui_display_name");

  el.authToken.value = "";
  el.userId.value = "demo_user_1";
  el.displayName.value = "Demo Voice";
  el.description.value = "";
  el.consentConfirmed.checked = true;
  el.voiceProfileId.value = "";
  el.sampleFile.value = "";
  el.voiceDetail.textContent = "";
  el.voiceList.textContent = "";
  el.previewText.value = "Hello team. This is the temporary frontend test for the voice cloning service.";
  el.previewAudio.removeAttribute("src");
  el.previewAudio.load();
  el.previewDetail.textContent = "";
  el.sessionId.value = "meeting_ui_demo";
  el.priority.value = "5";
  el.urgent.checked = false;
  el.runtimeText.value = "Thanks everyone. I reviewed the plan and I support the next step.";
  el.runtimeAudio.removeAttribute("src");
  el.runtimeAudio.load();
  el.runtimeDetail.textContent = "";
  el.activityLog.textContent = "";

  state.lastPreview = null;
  state.lastRuntimeJob = null;

  updateButtonStates();
  log("Reset the temporary UI.");
}

function renderVoiceList(items) {
  if (!items.length) {
    el.voiceList.textContent = "No voice profiles found for this user yet.";
    return;
  }

  el.voiceList.innerHTML = items.map((item) => `
    <div class="voice-item">
      <div><strong>${escapeHtml(item.display_name || item.id)}</strong></div>
      <div>ID: ${escapeHtml(item.id)}</div>
      <div>Status: ${escapeHtml(item.status)}</div>
      <div>Samples: ${escapeHtml(String(item.sample_count))}</div>
      <button type="button" data-voice-id="${escapeHtml(item.id)}">Use This Voice</button>
    </div>
  `).join("");

  el.voiceList.querySelectorAll("button[data-voice-id]").forEach((button) => {
    button.addEventListener("click", () => {
      el.voiceProfileId.value = button.dataset.voiceId;
      log(`Selected voice profile ${button.dataset.voiceId}`);
    });
  });
}

async function request(url, options = {}, useAuth = true) {
  try {
    const headers = {
      ...(options.headers || {})
    };

    if (useAuth) {
      const token = el.authToken.value.trim();
      if (!token) {
        throw new Error("Paste the INTERNAL_BACKEND_AUTH_TOKEN first.");
      }
      headers.Authorization = `Bearer ${token}`;
    }

    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      ...options,
      headers
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    return data;
  } catch (error) {
    log(`Error: ${error.message}`);
    throw error;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.split(",")[1]);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function toAudioUrl(filePath) {
  return `/audio/${encodeURIComponent(filePath.split("\\").pop())}`;
}

function format(value) {
  return JSON.stringify(value, null, 2);
}

function formatInline(value) {
  return JSON.stringify(value);
}

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.activityLog.textContent = `${line}\n${el.activityLog.textContent}`.trim();
}

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
