"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mic,
  PlayCircle,
  RefreshCcw,
  Upload,
  Waves,
} from "lucide-react";

type VoiceProfile = {
  id: string;
  user_id: string;
  provider: string;
  provider_voice_id: string | null;
  status: string;
  sample_count: number;
  consent_confirmed: boolean;
  created_at: string;
  updated_at?: string;
};

type VoiceResponse = {
  items: VoiceProfile[];
  active_voice: VoiceProfile | null;
};

type PreviewPayload = {
  preview_id: string;
  audio_url: string | null;
  duration_ms: number;
  content_type: string;
};

export default function VoiceSettingsPage() {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [activeVoice, setActiveVoice] = useState<VoiceProfile | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState("My Voice");
  const [description, setDescription] = useState("Personal meeting voice");
  const [consentConfirmed, setConsentConfirmed] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sampleAudioUrl, setSampleAudioUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState(
    "Hello team. This is the saved voice preview from the real My Voice page."
  );
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [usingSavedVoice, setUsingSavedVoice] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refreshVoices();
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      if (sampleAudioUrl) {
        URL.revokeObjectURL(sampleAudioUrl);
      }
      setSampleAudioUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(selectedFile);
    setSampleAudioUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [selectedFile]);

  const selectedVoice = useMemo(() => {
    return voices.find((voice) => voice.id === selectedVoiceId) ?? activeVoice;
  }, [voices, selectedVoiceId, activeVoice]);

  async function refreshVoices() {
    const res = await fetch("/api/voices/me");
    const data: VoiceResponse = await res.json();
    setVoices(data.items ?? []);
    setActiveVoice(data.active_voice ?? null);
    setSelectedVoiceId((current) => current ?? data.active_voice?.id ?? data.items?.[0]?.id ?? null);
  }

  async function handleCreateVoice() {
    if (!selectedFile || !voiceName.trim() || !consentConfirmed) {
      setError("Choose an audio file, enter a voice name, and confirm consent.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsCreating(true);

    try {
      const enrollRes = await fetch("/api/voices/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: voiceName.trim(),
          description: description.trim(),
          consent_confirmed: true,
        }),
      });

      const enrollBody = await enrollRes.json().catch(() => ({}));
      if (!enrollRes.ok) {
        throw new Error(enrollBody.error ?? "Could not create the voice profile.");
      }

      const formData = new FormData();
      formData.append("sample", selectedFile);
      const sampleRes = await fetch(`/api/voices/${enrollBody.id}/sample`, {
        method: "POST",
        body: formData,
      });

      const sampleBody = await sampleRes.json().catch(() => ({}));
      if (!sampleRes.ok) {
        throw new Error(sampleBody.error ?? "Could not upload the sample.");
      }

      const finalizeRes = await fetch(`/api/voices/${enrollBody.id}/finalize`, {
        method: "POST",
      });

      const finalizeBody = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) {
        throw new Error(finalizeBody.error ?? "Could not finalize the voice.");
      }

      setSuccess("Voice created successfully and saved in the voice service.");
      setSelectedVoiceId(finalizeBody.id);
      setUsingSavedVoice(true);
      setPreview(null);
      await refreshVoices();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Voice creation failed.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handlePreviewSavedVoice() {
    if (!selectedVoice) {
      setError("Create or choose a saved voice first.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsPreviewing(true);

    try {
      const res = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice_profile_id: selectedVoice.id,
          text: previewText,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not generate the saved voice preview.");
      }

      setPreview(body);
      setSuccess("Saved voice preview generated.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Saved voice preview failed.");
    } finally {
      setIsPreviewing(false);
    }
  }

  function handleUseSavedVoice(voiceId: string) {
    setSelectedVoiceId(voiceId);
    setUsingSavedVoice(true);
    setSuccess("Saved voice selected for use in this UI session.");
    setError(null);
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-8 flex items-start justify-between gap-6">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#6DD8F0]">
            Voice Settings
          </p>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-white">
            <Mic className="h-7 w-7 text-[#6DD8F0]" />
            My Voice
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Upload one voice file, save the created voice in the voice service, listen to your
            original sample, preview the saved cloned voice, and choose which saved voice to use.
          </p>
        </div>

        <button
          onClick={() => void refreshVoices()}
          className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-[#6DD8F0]/50 hover:text-white"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-900/40 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-900/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-6 rounded-3xl border border-slate-800/60 bg-[#0d1628] p-6 shadow-[0_24px_80px_rgba(4,8,15,0.45)]">
          <div>
            <h2 className="text-lg font-semibold text-white">Create a new saved voice</h2>
            <p className="mt-1 text-sm text-slate-400">
              This uses the same local voice-service flow that already worked in the temporary test UI.
            </p>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-200">Voice name</span>
            <input
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-[#6DD8F0]/60"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-200">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-[#6DD8F0]/60"
            />
          </label>

          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/30 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200">
              <Upload className="h-4 w-4 text-[#6DD8F0]" />
              Voice file
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-full file:border-0 file:bg-[#6DD8F0] file:px-4 file:py-2 file:font-medium file:text-slate-950 hover:file:bg-[#82e3f8]"
            />
            {selectedFile && (
              <div className="mt-4 rounded-2xl bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
                Selected file: <span className="font-medium text-white">{selectedFile.name}</span>
              </div>
            )}
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/30 px-4 py-4">
            <input
              type="checkbox"
              checked={consentConfirmed}
              onChange={(e) => setConsentConfirmed(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#6DD8F0]"
            />
            <span className="text-sm text-slate-300">
              I confirm that I own this file and consent to creating a saved meeting voice from it.
            </span>
          </label>

          <button
            onClick={() => void handleCreateVoice()}
            disabled={!selectedFile || !consentConfirmed || isCreating}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#3B82F6] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#4B90FA] disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Waves className="h-4 w-4" />}
            {isCreating ? "Creating voice..." : "Create Saved Voice"}
          </button>

          <div className="rounded-2xl border border-slate-800 bg-[#10182b] p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
              <PlayCircle className="h-4 w-4 text-[#6DD8F0]" />
              Play uploaded sample
            </div>
            {sampleAudioUrl ? (
              <audio controls className="w-full" src={sampleAudioUrl} />
            ) : (
              <p className="text-sm text-slate-500">Choose a file to hear the source sample here.</p>
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-800/60 bg-[#0d1628] p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Saved voices</h2>
            {voices.length === 0 ? (
              <p className="text-sm text-slate-400">
                No saved voices yet. Create one from the left panel.
              </p>
            ) : (
              <div className="space-y-3">
                {voices.map((voice) => (
                  <div
                    key={voice.id}
                    className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"
                  >
                    <div className="mb-3 text-sm font-medium text-white">{voice.id}</div>
                    <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                      Status
                    </div>
                    <div className="mb-3 text-sm text-slate-300">{voice.status}</div>
                    <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                      Voice ID
                    </div>
                    <div className="mb-4 break-all text-sm text-[#6DD8F0]">
                      {voice.provider_voice_id ?? "Not ready yet"}
                    </div>
                    <button
                      onClick={() => handleUseSavedVoice(voice.id)}
                      className="rounded-full border border-[#6DD8F0]/30 px-4 py-2 text-sm font-medium text-[#6DD8F0] transition-colors hover:bg-[#6DD8F0]/10"
                    >
                      Use saved voice
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-800/60 bg-[#0d1628] p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Saved voice preview</h2>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">Preview text</span>
              <textarea
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                rows={4}
                className="w-full rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-[#6DD8F0]/60"
              />
            </label>

            <button
              onClick={() => void handlePreviewSavedVoice()}
              disabled={!selectedVoice || isPreviewing}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              {isPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {isPreviewing ? "Generating preview..." : "Play saved voice"}
            </button>

            <div className="mt-5 rounded-2xl border border-slate-800 bg-[#10182b] p-5">
              <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                Current selection
              </div>
              <div className="mb-4 text-sm text-slate-200">
                {selectedVoice ? selectedVoice.id : "No saved voice selected"}
              </div>
              <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                Use state
              </div>
              <div className="mb-4 text-sm text-slate-200">
                {usingSavedVoice && selectedVoice ? "Using selected saved voice in this UI session." : "No saved voice selected yet."}
              </div>
              {preview?.audio_url ? (
                <audio controls className="w-full" src={preview.audio_url} />
              ) : (
                <p className="text-sm text-slate-500">
                  Generate a preview to hear the currently selected saved voice.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
