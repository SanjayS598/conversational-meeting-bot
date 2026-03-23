"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Video,
  Link2,
  AlertCircle,
  Bot,
  Lock,
  Target,
  FileText,
  ChevronDown,
  Upload,
  X,
  CheckCircle,
  Loader2,
  Mic,
} from "lucide-react";
import { getStoredSelectedVoiceProfileId, getStoredProviderVoiceId } from "@/lib/voice-selection";

// Accepted file types for document upload
const ACCEPTED_TYPES = [".pdf", ".pptx", ".ppt", ".txt", ".md"];
const ACCEPTED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "text/plain",
  "text/markdown",
];

interface PrepData {
  prep_id: string;
  greeting: string;
  docs: string[];
  context_length: number;
}

const PREP_STEPS = [
  { id: "extract", label: "Extracting documents" },
  { id: "context", label: "Building context" },
  { id: "gemini", label: "Generating greeting" },
  { id: "tts", label: "Rendering voice" },
  { id: "done", label: "Agent ready" },
];

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const colors: Record<string, string> = {
    pdf: "text-red-400 bg-red-950/40 border-red-800/50",
    pptx: "text-orange-400 bg-orange-950/40 border-orange-800/50",
    ppt: "text-orange-400 bg-orange-950/40 border-orange-800/50",
    txt: "text-blue-400 bg-blue-950/40 border-blue-800/50",
    md: "text-blue-400 bg-blue-950/40 border-blue-800/50",
  };
  const cls =
    colors[ext] ?? "text-slate-400 bg-slate-800/40 border-slate-700/50";
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono ${cls}`}
    >
      <span className="uppercase">{ext}</span>
      <span className="text-white/80 max-w-[160px] truncate">{file.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 text-slate-500 hover:text-slate-300 transition"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function NewMeetingPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [meetingUrl, setMeetingUrl] = useState("");
  const [passcode, setPasscode] = useState("");
  const [meetingObjective, setMeetingObjective] = useState("");
  const [prepNotes, setPrepNotes] = useState("");
  const [botDisplayName, setBotDisplayName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // File upload state
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Voice prep state
  const [prepData, setPrepData] = useState<PrepData | null>(null);
  const [prepStep, setPrepStep] = useState(0);

  // Flow state
  const [step, setStep] = useState<"form" | "preparing" | "ready" | "launching">("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const valid = Array.from(newFiles).filter((f) => {
      const ext = "." + (f.name.split(".").pop()?.toLowerCase() ?? "");
      return ACCEPTED_TYPES.includes(ext) || ACCEPTED_MIME.includes(f.type);
    });
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !names.has(f.name))];
    });
  }, []);

  // ── Voice Preparation ─────────────────────────────────────────────────────

  async function handlePrepare() {
    if (!botDisplayName.trim()) {
      setError("Agent display name is required for voice mode.");
      return;
    }
    setError(null);
    setStep("preparing");
    setPrepStep(0);

    const stepTimer = setInterval(
      () => setPrepStep((p) => Math.min(p + 1, PREP_STEPS.length - 2)),
      900
    );

    try {
      const fd = new FormData();
      fd.append("display_name", botDisplayName.trim());
      fd.append("personal_notes", prepNotes);
      files.forEach((f) => fd.append("files", f));

      const res = await fetch("/api/voice/prepare", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preparation failed");

      clearInterval(stepTimer);
      setPrepStep(PREP_STEPS.length - 1);
      setPrepData(data);
      await new Promise((r) => setTimeout(r, 500));
      setStep("ready");
    } catch (e: unknown) {
      clearInterval(stepTimer);
      setError(e instanceof Error ? e.message : "Preparation failed");
      setStep("form");
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const createRes = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_url: meetingUrl, provider: "zoom" }),
      });

      if (!createRes.ok) {
        const body = await createRes.json();
        throw new Error(body.error ?? "Failed to create meeting");
      }

      const { id } = await createRes.json();

      const startRes = await fetch(`/api/meetings/${id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passcode: passcode || undefined,
          meeting_objective: meetingObjective || undefined,
          prep_notes: prepNotes || undefined,
          bot_display_name: botDisplayName || undefined,
          prep_id: prepData?.prep_id || undefined,
          voice_profile_id: getStoredSelectedVoiceProfileId() || undefined,
          provider_voice_id: getStoredProviderVoiceId() || undefined,
        }),
      });

      if (!startRes.ok) {
        const body = await startRes.json();
        throw new Error(body.error ?? "Failed to start meeting session");
      }

      router.push(`/meetings/${id}/live`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  const hasVoiceConfig =
    !!botDisplayName.trim() || files.length > 0 || !!prepNotes.trim();

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Start a New Meeting</h1>
        <p className="text-slate-400 text-sm mt-1">
          Paste your Zoom meeting link to launch the meeting note taker.
        </p>
      </div>

      <div className="bg-[#0d1628] border border-slate-800/60 rounded-2xl p-6 space-y-6">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* ── Prep progress overlay ─── */}
        {step === "preparing" && (
          <div className="bg-[#111828] border border-slate-700/60 rounded-xl p-5 space-y-4">
            <p className="text-sm font-semibold text-white">Getting your agent ready…</p>
            <div className="space-y-3">
              {PREP_STEPS.map((ps, i) => {
                const done = i < prepStep;
                const current = i === prepStep;
                return (
                  <div key={ps.id} className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs border transition-all ${
                        done
                          ? "bg-[#6DD8F0] border-[#6DD8F0] text-black"
                          : current
                          ? "border-[#6DD8F0] bg-transparent"
                          : "border-slate-700 bg-transparent"
                      }`}
                    >
                      {done ? (
                        <CheckCircle className="w-3 h-3" />
                      ) : current ? (
                        <Loader2 className="w-3 h-3 animate-spin text-[#6DD8F0]" />
                      ) : (
                        <span className="text-slate-600">·</span>
                      )}
                    </div>
                    <span
                      className={`text-sm ${
                        done ? "text-white" : current ? "text-[#6DD8F0]" : "text-slate-500"
                      }`}
                    >
                      {ps.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Ready state ─── */}
        {step === "ready" && prepData && (
          <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-mono text-emerald-400 uppercase tracking-wide">
                Agent Ready
              </span>
            </div>
            {prepData.docs.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Docs loaded</p>
                <div className="flex flex-wrap gap-2">
                  {prepData.docs.map((d, i) => (
                    <span
                      key={i}
                      className="text-xs font-mono text-[#6DD8F0] bg-[#0d1a2a] border border-[#1a3050] rounded px-2 py-0.5"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1.5">
                Opening line (pre-rendered ✓)
              </p>
              <p className="text-sm text-white/80 italic leading-relaxed">
                &ldquo;{prepData.greeting}&rdquo;
              </p>
            </div>
            <p className="text-xs font-mono text-slate-500">
              {prepData.context_length.toLocaleString()} chars loaded
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Meeting URL */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Zoom Meeting URL <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="url"
                required
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://zoom.us/j/123456789"
                className="w-full bg-[#111828] border border-slate-700/80 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#6DD8F0]/60 focus:border-transparent transition"
              />
            </div>
          </div>

          {/* Passcode */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Passcode <span className="text-slate-500">(if required)</span>
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="123456"
                className="w-full bg-[#111828] border border-slate-700/80 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#6DD8F0]/60 focus:border-transparent transition"
              />
            </div>
          </div>

          {/* Meeting Objective */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Meeting Objective{" "}
              <span className="text-slate-500">(helps the AI take better notes)</span>
            </label>
            <div className="relative">
              <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={meetingObjective}
                onChange={(e) => setMeetingObjective(e.target.value)}
                placeholder="e.g. Quarterly product review and roadmap planning"
                className="w-full bg-[#111828] border border-slate-700/80 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#6DD8F0]/60 focus:border-transparent transition"
              />
            </div>
          </div>

          {/* ── Voice Agent Section ─── */}
          <div className="border border-slate-700/40 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-4 py-3 bg-[#111828] hover:bg-[#141e30] transition text-left"
            >
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-[#6DD8F0]" />
                <span className="text-sm font-medium text-white">Voice Agent</span>
                <span className="text-xs text-slate-500">
                  — give the bot a voice &amp; upload docs
                </span>
                {hasVoiceConfig && (
                  <span className="text-xs font-mono text-[#6DD8F0] bg-[#6DD8F0]/10 border border-[#6DD8F0]/30 rounded px-1.5 py-0.5">
                    configured
                  </span>
                )}
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-500 transition-transform ${
                  showAdvanced ? "rotate-180" : ""
                }`}
              />
            </button>

            {showAdvanced && (
              <div className="px-4 py-4 space-y-4 border-t border-slate-700/40">
                {/* Agent display name */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Agent Display Name{" "}
                    <span className="text-slate-500">
                      (name shown in Zoom — required for voice)
                    </span>
                  </label>
                  <div className="relative">
                    <Bot className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={botDisplayName}
                      onChange={(e) => setBotDisplayName(e.target.value)}
                      placeholder="e.g. Clairo, Alex, or your name"
                      className="w-full bg-[#111828] border border-slate-700/80 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#6DD8F0]/60 focus:border-transparent transition"
                    />
                  </div>
                </div>

                {/* Personal notes */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Background Notes{" "}
                    <span className="text-slate-500">
                      (context, talking points, attendee info)
                    </span>
                  </label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                    <textarea
                      value={prepNotes}
                      onChange={(e) => setPrepNotes(e.target.value)}
                      placeholder={"Meeting with Sarah about Q3 budget.\n• Need $120k for ML infra\n• Timeline is Q4"}
                      rows={4}
                      className="w-full bg-[#111828] border border-slate-700/80 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#6DD8F0]/60 focus:border-transparent transition resize-none"
                    />
                  </div>
                </div>

                {/* File upload */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Upload Documents{" "}
                    <span className="text-slate-500">(PDF · PPTX · TXT · MD — optional)</span>
                  </label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-5 flex flex-col items-center gap-2 cursor-pointer transition-all ${
                      dragOver ? "border-[#6DD8F0] bg-[#6DD8F0]/5" : "border-slate-700/60 hover:border-slate-600"
                    }`}
                  >
                    <Upload className={`w-5 h-5 ${dragOver ? "text-[#6DD8F0]" : "text-slate-500"}`} />
                    <p className={`text-sm ${dragOver ? "text-[#6DD8F0]" : "text-slate-500"}`}>
                      Drop files here or click to browse
                    </p>
                    <p className="text-xs text-slate-600">
                      The agent reads everything before joining — no loading delay
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ACCEPTED_TYPES.join(",")}
                      className="hidden"
                      onChange={(e) => e.target.files && addFiles(e.target.files)}
                    />
                  </div>
                  {files.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {files.map((f, i) => (
                        <FileChip
                          key={i}
                          file={f}
                          onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Prepare button */}
                {step !== "ready" && (
                  <button
                    type="button"
                    onClick={handlePrepare}
                    disabled={step === "preparing" || !botDisplayName.trim()}
                    className="w-full flex items-center justify-center gap-2 bg-[#1a2a1a] hover:bg-[#1e321e] border border-[#2a4a2a] disabled:opacity-50 disabled:cursor-not-allowed text-emerald-400 font-medium py-2.5 rounded-lg transition-colors text-sm"
                  >
                    {step === "preparing" ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Preparing agent…
                      </>
                    ) : (
                      <>
                        <Mic className="w-4 h-4" />
                        {files.length > 0
                          ? `Prepare agent with ${files.length} file${files.length > 1 ? "s" : ""}`
                          : "Prepare voice agent"}
                      </>
                    )}
                  </button>
                )}

                {step === "ready" && (
                  <button
                    type="button"
                    onClick={() => { setStep("form"); setPrepData(null); }}
                    className="text-xs text-slate-500 hover:text-slate-300 transition underline"
                  >
                    ← Re-configure agent
                  </button>
                )}
              </div>
            )}
          </div>

          {/* What the bot will do */}
          <div className="bg-[#6DD8F0]/5 border border-[#6DD8F0]/15 rounded-xl p-4 space-y-2.5">
            <p className="text-xs font-semibold text-[#6DD8F0] uppercase tracking-wide mb-1">
              What Clairo will do
            </p>
            {[
              { icon: Video, text: "Join the Zoom call as a participant" },
              {
                icon: Bot,
                text: prepData
                  ? `Speak as ${botDisplayName || "the agent"} using ElevenLabs voice`
                  : "Listen and transcribe the conversation in real time",
              },
              { icon: FileText, text: "Generate structured meeting notes you can review after the call" },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm text-slate-300">
                <Icon className="w-4 h-4 text-[#6DD8F0] flex-shrink-0" />
                {text}
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading || step === "preparing"}
            className="w-full flex items-center justify-center gap-2 bg-[#3B82F6] hover:bg-[#4F94F8] disabled:bg-[#1D4ED8] disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin w-4 h-4" />
                Launching…
              </>
            ) : (
              <>
                <Video className="w-4 h-4" />
                {step === "ready"
                  ? "Join meeting with voice agent →"
                  : "Launch Meeting Note Taker"}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

