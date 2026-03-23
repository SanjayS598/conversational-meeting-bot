export const SELECTED_VOICE_PROFILE_STORAGE_KEY = "selected_voice_profile_id";

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