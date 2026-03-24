"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Radio,
  Play,
  Pause,
  Search,
  Library,
  User,
} from "lucide-react";
import clsx from "clsx";
import type { VoiceProfile } from "@/lib/types";
import {
  getStoredSelectedVoiceProfileId,
  setStoredSelectedVoiceProfileId,
  getStoredProviderVoiceId,
  setStoredProviderVoiceId,
} from "@/lib/voice-selection";

const STEP_LABELS = ["Consent", "Upload Samples", "Finalize"];
const PREVIEW_TEXT = "Hello! This is a preview of how I will sound during your meetings.";

interface VoicesResponse {
  items: VoiceProfile[];
  selected_voice_profile_id: string | null;
  current_voice_id: string | null;
}

interface LibraryVoice {
  voice_id: string;
  name: string;
  category: string;
  preview_url: string | null;
  labels: Record<string, string>;
  accent: string | null;
  gender: string | null;
  age: string | null;
  use_case: string | null;
}

function dedupeProfiles(items: VoiceProfile[]): VoiceProfile[] {
  const seen = new Set<string>();
  const unique: VoiceProfile[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

// ── Audio preview hook ──────────────────────────────────────────────────────

function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setPlayingId(null);
  }, []);

  const play = useCallback(
    async (id: string, getAudioUrl: () => Promise<string>) => {
      if (playingId === id) {
        stop();
        return;
      }
      stop();
      setLoadingId(id);
      try {
        const url = await getAudioUrl();
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => setPlayingId(null);
        audio.onerror = () => setPlayingId(null);
        await audio.play();
        setPlayingId(id);
      } catch {
        setPlayingId(null);
      } finally {
        setLoadingId(null);
      }
    },
    [playingId, stop]
  );

  useEffect(() => () => stop(), [stop]);

  return { playingId, loadingId, play, stop };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function VoiceSettingsPage() {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState<string | null>(null);
  const [currentVoiceId, setCurrentVoiceId] = useState<string | null>(null);
  const [currentVoiceName, setCurrentVoiceName] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState("");
  const [step, setStep] = useState(0);
  const [consentChecked, setConsentChecked] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Library voice browser
  const [activeTab, setActiveTab] = useState<"my-voices" | "library">("my-voices");
  const [libraryVoices, setLibraryVoices] = useState<LibraryVoice[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<"all" | "premade" | "cloned">("all");
  const [librarySelectedId, setLibrarySelectedId] = useState<string | null>(null);
  const [selectSuccess, setSelectSuccess] = useState<string | null>(null);

  const { playingId, loadingId, play, stop } = useAudioPlayer();

  const loadVoices = useCallback(async () => {
    const res = await fetch("/api/voices/me");
    const data = (await res.json()) as VoicesResponse & { error?: string };
    if (!res.ok) {
      if (res.status !== 404) throw new Error(data.error ?? "Failed to load voices");
      setProfiles([]);
      setSelectedVoiceProfileId(null);
      setCurrentVoiceId(null);
      setCurrentVoiceName(null);
      return;
    }

    const items = dedupeProfiles(data.items ?? []);
    const storedSelectedId = getStoredSelectedVoiceProfileId();
    const storedProviderVoiceId = getStoredProviderVoiceId();
    const effectiveSelectedId =
      items.some((item) => item.id === storedSelectedId)
        ? storedSelectedId
        : data.selected_voice_profile_id ?? null;
    const effectiveSelectedProfile = items.find((item) => item.id === effectiveSelectedId) ?? null;
    const effectiveProviderVoiceId =
      effectiveSelectedProfile?.provider_voice_id
        ?? storedProviderVoiceId
        ?? data.current_voice_id
        ?? null;

    setProfiles(items);
    setSelectedVoiceProfileId(effectiveSelectedId);
    setCurrentVoiceId(effectiveProviderVoiceId);
    setCurrentVoiceName(effectiveSelectedProfile?.display_name ?? null);
    setLibrarySelectedId(
      effectiveSelectedProfile?.provider_voice_id ? null : effectiveProviderVoiceId
    );

    if (effectiveSelectedId) setStoredSelectedVoiceProfileId(effectiveSelectedId);
    setStoredProviderVoiceId(effectiveProviderVoiceId);

    const activeProfile = effectiveSelectedProfile;
    const latestPending = items.find((item) => item.status !== "ready") ?? null;
    const workingProfile = latestPending ?? activeProfile;
    if (workingProfile) {
      setProfileId(workingProfile.id);
      setUploadedCount(workingProfile.sample_count ?? 0);
      if (workingProfile.status === "ready") setStep(2);
      else if ((workingProfile.sample_count ?? 0) > 0) setStep(1);
      else setStep(0);
    }
  }, []);

  const loadLibraryVoices = useCallback(async () => {
    if (libraryVoices.length > 0) return; // cached
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const res = await fetch("/api/voices/library?category=all");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load voice library");
      setLibraryVoices(data.items ?? []);
    } catch (err: unknown) {
      setLibraryError(err instanceof Error ? err.message : "Failed to load voice library");
    } finally {
      setLibraryLoading(false);
    }
  }, [libraryVoices.length]);

  useEffect(() => {
    loadVoices().catch(() => {});
  }, [loadVoices]);

  useEffect(() => {
    if (activeTab === "library") loadLibraryVoices();
  }, [activeTab, loadLibraryVoices]);

  useEffect(() => {
    if (selectedVoiceProfileId || !currentVoiceId || libraryVoices.length === 0) return;
    const selectedLibraryVoice = libraryVoices.find((voice) => voice.voice_id === currentVoiceId);
    if (selectedLibraryVoice) {
      setCurrentVoiceName(selectedLibraryVoice.name);
      setLibrarySelectedId(selectedLibraryVoice.voice_id);
    }
  }, [libraryVoices, currentVoiceId, selectedVoiceProfileId]);

  const profile = profiles.find((item) => item.id === profileId) ?? null;

  // ── Preview helpers ────────────────────────────────────────────────────────

  async function previewLibraryVoice(voice: LibraryVoice) {
    if (voice.preview_url) {
      // ElevenLabs supplies a direct preview URL — just play it
      await play(voice.voice_id, async () => voice.preview_url!);
    } else {
      // Fallback: generate TTS preview via our API
      await play(voice.voice_id, async () => {
        const res = await fetch("/api/voices/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: PREVIEW_TEXT, provider_voice_id: voice.voice_id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Preview failed");
        return data.audio_url as string;
      });
    }
  }

  async function previewClonedVoice(voiceProfile: VoiceProfile) {
    if (!voiceProfile.provider_voice_id) return;
    await play(voiceProfile.id, async () => {
      const res = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: PREVIEW_TEXT, provider_voice_id: voiceProfile.provider_voice_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      return data.audio_url as string;
    });
  }

  // ── Enrollment flow ────────────────────────────────────────────────────────

  async function handleEnroll() {
    if (!consentChecked) return;
    setEnrolling(true);
    setError(null);
    try {
      const res = await fetch("/api/voices/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent_confirmed: true, display_name: voiceName.trim() || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Enroll failed");
      const data = await res.json();
      setProfileId(data.id);
      setProfiles((prev) => dedupeProfiles([data, ...prev]));
      setStep(1);
      setUploadedCount(0);
      setVoiceName("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !profileId) return;
    setUploading(true);
    setError(null);
    for (const file of files) {
      try {
        const form = new FormData();
        form.append("sample", file);
        const res = await fetch(`/api/voices/${profileId}/sample`, { method: "POST", body: form });
        if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
        const data = await res.json();
        setUploadedCount(data.sample_count ?? uploadedCount + 1);
        setProfiles((prev) => dedupeProfiles(prev.map((item) => (item.id === data.id ? data : item))));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Upload failed");
        break;
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleFinalize() {
    if (!profileId) return;
    setFinalizing(true);
    setError(null);
    try {
      const res = await fetch(`/api/voices/${profileId}/finalize`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Finalize failed");
      const data = await res.json();
      setProfiles((prev) => dedupeProfiles(prev.map((item) => (item.id === data.id ? data : item))));
      setStoredSelectedVoiceProfileId(data.id);
      setStoredProviderVoiceId(data.provider_voice_id ?? null);
      setSelectedVoiceProfileId(data.id);
      setLibrarySelectedId(null);
      setCurrentVoiceId(data.provider_voice_id ?? null);
      setCurrentVoiceName((data as VoiceProfile).display_name ?? null);
      await loadVoices();
      setStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Finalization failed");
    } finally {
      setFinalizing(false);
    }
  }

  async function handleSelect(id: string) {
    setSelectingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/voices/${id}/select`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to select voice");
      setStoredSelectedVoiceProfileId(id);
      setStoredProviderVoiceId(data.current_voice_id ?? null);
      setSelectedVoiceProfileId(id);
      setLibrarySelectedId(null);
      setCurrentVoiceId(data.current_voice_id ?? null);
      setCurrentVoiceName(profiles.find((p) => p.id === id)?.display_name ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to select voice");
    } finally {
      setSelectingId(null);
    }
  }

  // ── Filtered library voices ────────────────────────────────────────────────

  const filteredLibrary = libraryVoices.filter((v) => {
    const q = librarySearch.toLowerCase();
    const matchesSearch = !q || v.name.toLowerCase().includes(q) ||
      (v.accent ?? "").toLowerCase().includes(q) ||
      (v.gender ?? "").toLowerCase().includes(q) ||
      (v.use_case ?? "").toLowerCase().includes(q);
    const matchesFilter = libraryFilter === "all" || v.category === libraryFilter;
    return matchesSearch && matchesFilter;
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Mic className="w-6 h-6 text-[#6DD8F0]" />
          My Voice
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Clone your voice or choose an ElevenLabs voice for the AI to speak in meetings.
        </p>
      </div>

      {/* Active voice — always visible above tabs */}
      <div className="bg-[#0d1628] border border-slate-800/60 rounded-xl px-4 py-3 mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-0.5">Active Voice</p>
          {currentVoiceName || currentVoiceId ? (
            <p className="text-sm font-medium text-[#6DD8F0]">{currentVoiceName ?? currentVoiceId}</p>
          ) : (
            <p className="text-sm text-slate-500 italic">No voice selected yet</p>
          )}
        </div>
        {selectSuccess && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-2.5 py-1.5 flex-shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {selectSuccess}
          </div>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 bg-[#0d1628] border border-slate-800/60 rounded-xl p-1">
        <button
          onClick={() => setActiveTab("my-voices")}
          className={clsx(
            "flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            activeTab === "my-voices"
              ? "bg-[#3B82F6] text-white"
              : "text-slate-400 hover:text-white"
          )}
        >
          <User className="w-4 h-4" />
          My Cloned Voices
        </button>
        <button
          onClick={() => setActiveTab("library")}
          className={clsx(
            "flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            activeTab === "library"
              ? "bg-[#3B82F6] text-white"
              : "text-slate-400 hover:text-white"
          )}
        >
          <Library className="w-4 h-4" />
          Voice Library
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5 mb-5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── My Cloned Voices Tab ─────────────────────────────────────────── */}
      {activeTab === "my-voices" && (
        <>
          {/* Cloned voice list */}
          {profiles.length > 0 && (
          <div className="bg-[#0d1628] border border-slate-800/60 rounded-2xl p-6 space-y-4 mb-6">
            <h2 className="text-base font-semibold text-white">My Cloned Voices</h2>
            <div className="space-y-3">
                {profiles.map((item) => {
                  const selected = item.id === selectedVoiceProfileId;
                  const ready = item.status === "ready" && !!item.provider_voice_id;
                  const isPlaying = playingId === item.id;
                  const isLoading = loadingId === item.id;
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/70 bg-[#111828] px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-white truncate">{item.display_name ?? "My Voice"}</p>
                          {selected && <span className="text-[10px] uppercase tracking-wide text-emerald-400">Selected</span>}
                        </div>
                        <p className="text-xs text-slate-400">Status: {item.status} · Samples: {item.sample_count}</p>
                        <p className="text-xs font-mono text-slate-500 break-all">{item.provider_voice_id ?? "Not yet cloned"}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {ready && (
                          <button
                            type="button"
                            onClick={() => previewClonedVoice(item)}
                            disabled={isLoading}
                            className="flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white transition-colors disabled:opacity-50"
                            title="Preview this voice"
                          >
                            {isLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : isPlaying ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!ready || selectingId === item.id || selected}
                          onClick={() => handleSelect(item.id)}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-[#3B82F6] hover:bg-[#4F94F8] disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors"
                        >
                          {selectingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
                          {selected ? "Active" : "Use Voice"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Clone a new voice stepper */}
          <div className="mb-3">
            <h2 className="text-base font-semibold text-white">Clone Your Voice</h2>
            <p className="text-sm text-slate-400 mt-0.5">Record or upload samples to create a personalised clone.</p>
          </div>

          {/* Stepper */}
          <div className="flex items-center mb-8">
            {STEP_LABELS.map((label, i) => (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div
                    className={clsx(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors",
                      i < step ? "bg-emerald-600 text-white" : i === step ? "bg-[#3B82F6] text-white" : "bg-slate-800 text-slate-500"
                    )}
                  >
                    {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                  </div>
                  <span className={clsx("text-xs mt-1.5 font-medium", i === step ? "text-[#6DD8F0]" : "text-slate-500")}>
                    {label}
                  </span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <div className={clsx("flex-1 h-0.5 mx-2 rounded mb-5", i < step ? "bg-emerald-600" : "bg-slate-800")} />
                )}
              </div>
            ))}
          </div>

          {/* Step 0: Consent */}
          {step === 0 && (
            <div className="bg-[#0d1628] border border-slate-800/60 rounded-2xl p-6 space-y-5">
              <div className="flex items-start gap-3 p-4 bg-[#6DD8F0]/5 border border-[#6DD8F0]/15 rounded-xl">
                <ShieldCheck className="w-5 h-5 text-[#6DD8F0] flex-shrink-0 mt-0.5" />
                <div className="text-sm text-slate-300 space-y-1">
                  <p className="font-medium text-white">Voice Cloning Consent</p>
                  <p>
                    By continuing, you consent to creating an AI clone of your voice using ElevenLabs.
                    Your voice data will be stored securely and used only to generate spoken responses
                    on your behalf during meetings. You can delete your voice profile at any time.
                  </p>
                </div>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 accent-[#6DD8F0] w-4 h-4"
                />
                <span className="text-sm text-slate-300">I consent to creating a voice clone for use in Clairo meetings.</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Voice Name</label>
                <input
                  type="text"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  className="w-full bg-[#111828] border border-slate-700/80 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#6DD8F0]/60 focus:border-transparent transition"
                  placeholder="e.g. Boardroom Voice"
                />
              </div>
              <button
                onClick={handleEnroll}
                disabled={!consentChecked || enrolling}
                className="flex items-center gap-2 bg-[#3B82F6] hover:bg-[#4F94F8] disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
              >
                {enrolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                {enrolling ? "Starting enrollment…" : "Start Voice Enrollment"}
              </button>
            </div>
          )}

          {/* Step 1: Upload samples */}
          {step === 1 && (
            <div className="bg-[#0d1628] border border-slate-800/60 rounded-2xl p-6 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-white mb-1">Upload Voice Samples</h2>
                <p className="text-sm text-slate-400">
                  Upload 3–5 clear audio recordings of your voice (WAV or MP3, 30–60 seconds each). More samples improve clone quality.
                </p>
              </div>
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-[#6DD8F0]/50 rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors"
              >
                <Upload className="w-8 h-8 text-slate-500" />
                <p className="text-sm text-slate-400">Click to select audio files, or drag and drop</p>
                <p className="text-xs text-slate-600">WAV, MP3 — max 25 MB each</p>
                <input ref={fileRef} type="file" accept="audio/*" multiple className="hidden" onChange={handleFileUpload} />
              </div>
              {uploading && (
                <div className="flex items-center gap-2 text-sm text-[#6DD8F0]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading samples…
                </div>
              )}
              {uploadedCount > 0 && (
                <div className="flex items-center gap-2 text-sm text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  {uploadedCount} sample{uploadedCount > 1 ? "s" : ""} uploaded
                </div>
              )}
              <button
                onClick={handleFinalize}
                disabled={uploadedCount < 1 || finalizing}
                className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
              >
                {finalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {finalizing ? "Creating voice clone…" : "Finalize Voice Clone"}
              </button>
              <p className="text-xs text-slate-600">At least 1 sample required. Cloning may take up to a minute.</p>
            </div>
          )}

          {/* Step 2: Done */}
          {step === 2 && profile && (
            <div className="bg-[#0d1628] border border-slate-800/60 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-3 p-4 bg-emerald-950/30 border border-emerald-900/40 rounded-xl">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-white font-semibold">Voice clone ready</p>
                  <p className="text-sm text-slate-400">Your voice has been cloned and is ready to use in meetings.</p>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <InfoRow label="Voice Name" value={profile.display_name ?? "My Voice"} />
                <InfoRow label="Status" value={profile.status} />
                <InfoRow label="Provider" value={profile.provider} />
                <InfoRow label="Provider Voice ID" value={profile.provider_voice_id ?? "not assigned"} />
                <InfoRow label="Samples uploaded" value={String(profile.sample_count)} />
                <InfoRow label="Created" value={new Date(profile.created_at).toLocaleDateString()} />
              </div>
              <div className="pt-2 border-t border-slate-800 flex gap-3">
                {profile.provider_voice_id && (
                  <button
                    type="button"
                    onClick={() => previewClonedVoice(profile)}
                    disabled={loadingId === profile.id}
                    className="flex items-center gap-2 text-sm bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {loadingId === profile.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : playingId === profile.id ? (
                      <><Pause className="w-4 h-4" /> Stop preview</>
                    ) : (
                      <><Play className="w-4 h-4" /> Preview voice</>
                    )}
                  </button>
                )}
                <button
                  onClick={() => { setProfileId(null); setUploadedCount(0); setConsentChecked(false); setStep(0); }}
                  className="flex items-center gap-2 text-sm text-[#6DD8F0] hover:text-[#93C5FD] transition-colors"
                >
                  <Mic className="w-4 h-4" />
                  Create another voice
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Voice Library Tab ─────────────────────────────────────────────── */}
      {activeTab === "library" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Browse ElevenLabs voices. Click <Play className="w-3 h-3 inline" /> to preview, then <strong className="text-white">Use Voice</strong> to select it for your meetings.
          </p>

          {/* Search + filter bar */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search by name, accent, gender…"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                className="w-full bg-[#0d1628] border border-slate-800/60 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#6DD8F0]/60 transition"
              />
            </div>
            <select
              value={libraryFilter}
              onChange={(e) => setLibraryFilter(e.target.value as typeof libraryFilter)}
              className="bg-[#0d1628] border border-slate-800/60 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6DD8F0]/60 transition"
            >
              <option value="all">All voices</option>
              <option value="premade">ElevenLabs voices</option>
              <option value="cloned">My cloned voices</option>
            </select>
          </div>

          {libraryLoading && (
            <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading voices…
            </div>
          )}

          {libraryError && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {libraryError}
            </div>
          )}

          {!libraryLoading && !libraryError && filteredLibrary.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">
              {librarySearch ? "No voices match your search." : "No voices found."}
            </div>
          )}

          <div className="grid gap-3">
            {filteredLibrary.map((voice) => {
              const isPlaying = playingId === voice.voice_id;
              const isLoading = loadingId === voice.voice_id;
              const tags = [voice.gender, voice.accent, voice.age, voice.use_case]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={voice.voice_id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/70 bg-[#0d1628] px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-white">{voice.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wide">
                        {voice.category}
                      </span>
                    </div>
                    {tags && <p className="text-xs text-slate-500 mt-0.5 capitalize">{tags}</p>}
                    <p className="text-xs font-mono text-slate-600 mt-0.5">{voice.voice_id}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => previewLibraryVoice(voice)}
                      disabled={isLoading}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium bg-slate-700 hover:bg-slate-600 text-white transition-colors disabled:opacity-50"
                      title={isPlaying ? "Stop preview" : "Preview voice"}
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isPlaying ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={librarySelectedId === voice.voice_id}
                      onClick={async () => {
                        stop();
                        setError(null);
                        setSelectSuccess(null);
                        try {
                          // Optimistically update UI first
                          setLibrarySelectedId(voice.voice_id);
                          setCurrentVoiceId(voice.voice_id);
                          setCurrentVoiceName(voice.name);
                          setSelectedVoiceProfileId(null);
                          setStoredSelectedVoiceProfileId(null);
                          setStoredProviderVoiceId(voice.voice_id);
                          // Persist to server
                          const res = await fetch("/api/users/me/preferences", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ provider_voice_id: voice.voice_id }),
                          });
                          if (!res.ok) {
                            const data = await res.json().catch(() => ({}));
                            console.warn("[VoiceLibrary] preferences update failed:", data.error);
                          }
                          setSelectSuccess(`"${voice.name}" selected`);
                          setTimeout(() => setSelectSuccess(null), 3000);
                        } catch (err: unknown) {
                          setError(err instanceof Error ? err.message : "Failed to select voice");
                          setLibrarySelectedId(null);
                        }
                      }}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-[#3B82F6] hover:bg-[#4F94F8] disabled:bg-emerald-700 disabled:cursor-default text-white transition-colors"
                    >
                      {librarySelectedId === voice.voice_id ? (
                        <><CheckCircle2 className="w-4 h-4" /> Active</>
                      ) : (
                        <><Radio className="w-4 h-4" /> Use Voice</>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/50">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 font-medium capitalize">{value}</span>
    </div>
  );
}
