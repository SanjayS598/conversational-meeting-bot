"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Video, Link2, AlertCircle, Bot } from "lucide-react";

export default function NewMeetingPage() {
  const router = useRouter();
  const [meetingUrl, setMeetingUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_url: meetingUrl, provider: "zoom" }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to create meeting");
      }

      const { id } = await res.json();
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
          Paste your Zoom meeting link to launch the AI assistant.
        </p>
      </div>

      <div className="bg-[#0d1628] border border-slate-800/60 rounded-2xl p-6">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5 mb-5">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Zoom Meeting URL
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

          {/* What the bot will do */}
          <div className="bg-[#6DD8F0]/5 border border-[#6DD8F0]/15 rounded-xl p-4 space-y-2.5">
            <p className="text-xs font-semibold text-[#6DD8F0] uppercase tracking-wide mb-1">
              What Clairo will do
            </p>
            {[
              { icon: Video, text: "Join the Zoom call as a silent participant" },
              { icon: Bot, text: "Listen and transcribe the conversation in real time" },
              { icon: Bot, text: "Suggest replies and capture notes automatically" },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm text-slate-300">
                <Icon className="w-4 h-4 text-[#6DD8F0] flex-shrink-0" />
                {text}
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-[#3B82F6] hover:bg-[#4F94F8] disabled:bg-[#1D4ED8] disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Creating session…
              </>
            ) : (
              <>
                <Video className="w-4 h-4" />
                Launch Meeting Assistant
              </>
            )}
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-600 text-center mt-4">
        Make sure your voice profile is enrolled in{" "}
        <a href="/settings/voice" className="text-[#6DD8F0] hover:text-[#97E8F7]">
          Settings → My Voice
        </a>{" "}
        before joining.
      </p>
    </div>
  );
}
