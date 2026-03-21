"use client";

import { useState, useEffect, useRef } from "react";
import {
  Mic,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import type { VoiceProfile } from "@/lib/types";

const STEP_LABELS = ["Consent", "Upload Samples", "Finalize"];

export default function VoiceSettingsPage() {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [step, setStep] = useState(0); // 0=consent, 1=upload, 2=finalize
  const [consentChecked, setConsentChecked] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/voices/me")
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) {
          setProfile(data);
          setProfileId(data.id);
          setUploadedCount(data.sample_count ?? 0);
          if (data.status === "ready") setStep(2);
          else if (data.sample_count > 0) setStep(1);
          else setStep(0);
        }
      })
      .catch(() => {});
  }, []);

  async function handleEnroll() {
    if (!consentChecked) return;
    setEnrolling(true);
    setError(null);
    try {
      const res = await fetch("/api/voices/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent_confirmed: true }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Enroll failed");
      const data = await res.json();
      setProfileId(data.id);
      setProfile(data);
      setStep(1);
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
        const res = await fetch(`/api/voices/${profileId}/sample`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
        setUploadedCount((c) => c + 1);
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
      const res = await fetch(`/api/voices/${profileId}/finalize`, {
        method: "POST",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Finalize failed");
      const data = await res.json();
      setProfile(data);
      setStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Finalization failed");
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Mic className="w-6 h-6 text-indigo-400" />
          My Voice
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Enroll your voice so the AI can speak in meetings using your cloned voice.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center mb-8">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={clsx(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors",
                  i < step
                    ? "bg-emerald-600 text-white"
                    : i === step
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-800 text-slate-500"
                )}
              >
                {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span
                className={clsx(
                  "text-xs mt-1.5 font-medium",
                  i === step ? "text-indigo-400" : "text-slate-500"
                )}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={clsx(
                  "flex-1 h-0.5 mx-2 rounded mb-5",
                  i < step ? "bg-emerald-600" : "bg-slate-800"
                )}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5 mb-5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Step 0: Consent */}
      {step === 0 && (
        <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-start gap-3 p-4 bg-indigo-950/30 border border-indigo-900/40 rounded-xl">
            <ShieldCheck className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-slate-300 space-y-1">
              <p className="font-medium text-white">Voice Cloning Consent</p>
              <p>
                By proceeding, you consent to creating an AI clone of your voice
                using ElevenLabs. Your voice data will be stored securely and used
                only to generate spoken responses on your behalf during meetings.
              </p>
              <p>You can delete your voice profile at any time.</p>
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 accent-indigo-500 w-4 h-4"
            />
            <span className="text-sm text-slate-300">
              I consent to creating a voice clone for use in MeetBot meetings.
            </span>
          </label>

          <button
            onClick={handleEnroll}
            disabled={!consentChecked || enrolling}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
          >
            {enrolling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
            {enrolling ? "Starting enrollment…" : "Start Voice Enrollment"}
          </button>
        </div>
      )}

      {/* Step 1: Upload samples */}
      {step === 1 && (
        <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-white mb-1">
              Upload Voice Samples
            </h2>
            <p className="text-sm text-slate-400">
              Upload 3–5 clear audio recordings of your voice (WAV or MP3, 30–60 seconds each).
              More samples improve clone quality.
            </p>
          </div>

          {/* Upload area */}
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors"
          >
            <Upload className="w-8 h-8 text-slate-500" />
            <p className="text-sm text-slate-400">
              Click to select audio files, or drag and drop
            </p>
            <p className="text-xs text-slate-600">WAV, MP3 — max 25 MB each</p>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          {uploading && (
            <div className="flex items-center gap-2 text-sm text-indigo-400">
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
            {finalizing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {finalizing ? "Creating voice clone…" : "Finalize Voice Clone"}
          </button>
          <p className="text-xs text-slate-600">
            At least 1 sample required. Cloning may take up to a minute.
          </p>
        </div>
      )}

      {/* Step 2: Done / profile info */}
      {step === 2 && profile && (
        <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3 p-4 bg-emerald-950/30 border border-emerald-900/40 rounded-xl">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-white font-semibold">Voice clone ready</p>
              <p className="text-sm text-slate-400">
                Your voice has been cloned and is ready to use in meetings.
              </p>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <InfoRow label="Status" value={profile.status} />
            <InfoRow label="Provider" value={profile.provider} />
            <InfoRow label="Samples uploaded" value={String(profile.sample_count)} />
            <InfoRow
              label="Created"
              value={new Date(profile.created_at).toLocaleDateString()}
            />
          </div>

          <div className="pt-2 border-t border-slate-800">
            <button
              onClick={() => {
                setProfile(null);
                setProfileId(null);
                setUploadedCount(0);
                setConsentChecked(false);
                setStep(0);
              }}
              className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete voice profile and re-enroll
            </button>
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
