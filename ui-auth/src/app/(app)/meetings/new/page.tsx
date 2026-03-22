"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Video, Link2, AlertCircle, Bot, Lock, Target, FileText, ChevronDown } from "lucide-react";

export default function NewMeetingPage() {
  const router = useRouter();
  const [meetingUrl, setMeetingUrl] = useState("");
  const [passcode, setPasscode] = useState("");
  const [meetingObjective, setMeetingObjective] = useState("");
  const [prepNotes, setPrepNotes] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1. Create the session record
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

      // 2. Immediately start the session, passing optional context
      const startRes = await fetch(`/api/meetings/${id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passcode: passcode || undefined,
          meeting_objective: meetingObjective || undefined,
          prep_notes: prepNotes || undefined,
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

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Start a New Meeting</h1>
        <p className="text-slate-400 text-sm mt-1">
          Paste your Zoom meeting link to launch the meeting note taker.
        </p>
      </div>

      <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-6">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5 mb-5">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
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
                className="w-full bg-[#131c30] border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
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
                className="w-full bg-[#131c30] border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />
            </div>
          </div>

          {/* Meeting Objective */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Meeting Objective <span className="text-slate-500">(helps the AI take better notes)</span>
            </label>
            <div className="relative">
              <Target className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={meetingObjective}
                onChange={(e) => setMeetingObjective(e.target.value)}
                placeholder="e.g. Quarterly product review and roadmap planning"
                className="w-full bg-[#131c30] border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />
            </div>
          </div>

          {/* Prep Notes (advanced, collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              {showAdvanced ? "Hide" : "Add"} prep notes / background context
            </button>

            {showAdvanced && (
              <div className="mt-3">
                <div className="relative">
                  <FileText className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                  <textarea
                    value={prepNotes}
                    onChange={(e) => setPrepNotes(e.target.value)}
                    placeholder="Any background info, attendees, agenda items, or context the AI should know before the meeting starts…"
                    rows={4}
                    className="w-full bg-[#131c30] border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* What the bot will do */}
          <div className="bg-indigo-950/30 border border-indigo-900/40 rounded-xl p-4 space-y-2.5">
            <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wide mb-1">
              What MeetBot will do
            </p>
            {[
              { icon: Video, text: "Join the Zoom call as a silent participant" },
              { icon: Bot, text: "Listen and transcribe the conversation in real time" },
              { icon: FileText, text: "Generate structured meeting notes you can review after the call" },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm text-slate-300">
                <Icon className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                {text}
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Launching…
              </>
            ) : (
              <>
                <Video className="w-4 h-4" />
                Launch Meeting Note Taker
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

