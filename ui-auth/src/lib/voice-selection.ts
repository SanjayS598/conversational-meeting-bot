export const SELECTED_VOICE_PROFILE_STORAGE_KEY = "selected_voice_profile_id";
export const SELECTED_PROVIDER_VOICE_ID_KEY = "selected_provider_voice_id";

export function getStoredSelectedVoiceProfileId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_VOICE_PROFILE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSelectedVoiceProfileId(voiceProfileId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (voiceProfileId) {
      window.localStorage.setItem(SELECTED_VOICE_PROFILE_STORAGE_KEY, voiceProfileId);
      return;
    }
    window.localStorage.removeItem(SELECTED_VOICE_PROFILE_STORAGE_KEY);
  } catch {
    // Ignore browser storage failures.
  }
}

/** Stores a directly-selected ElevenLabs provider_voice_id (e.g. a library voice). */
export function getStoredProviderVoiceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_PROVIDER_VOICE_ID_KEY);
  } catch {
    return null;
  }
}

export function setStoredProviderVoiceId(voiceId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (voiceId) {
      window.localStorage.setItem(SELECTED_PROVIDER_VOICE_ID_KEY, voiceId);
      return;
    }
    window.localStorage.removeItem(SELECTED_PROVIDER_VOICE_ID_KEY);
  } catch {
    // Ignore browser storage failures.
  }
}
