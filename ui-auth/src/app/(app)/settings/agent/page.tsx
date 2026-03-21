"use client";

import { useState, useEffect } from "react";
import { Bot, Save, AlertCircle, CheckCircle2 } from "lucide-react";
import type { AgentMode, UserPreferences } from "@/lib/types";
import clsx from "clsx";

const MODES: { value: AgentMode; label: string; description: string }[] = [
  {
    value: "notes_only",
    label: "Notes Only",
    description: "Silently captures notes and transcript. Never speaks.",
  },
  {
    value: "suggest_replies",
    label: "Suggest Replies",
    description: "Shows reply suggestions on-screen for you to approve.",
  },
  {
    value: "auto_speak",
    label: "Auto Speak",
    description: "Automatically speaks short replies in your cloned voice.",
  },
];

const TONES = ["professional", "casual", "concise", "detailed", "friendly"];

export default function AgentSettingsPage() {
  const [prefs, setPrefs] = useState<Partial<UserPreferences>>({
    agent_display_name: "MeetBot",
    mode: "suggest_replies",
    tone: "professional",
    speak_threshold: 0.75,
    default_meeting_provider: "zoom",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users/me/preferences")
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) setPrefs(data);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/users/me/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading preferences…</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Bot className="w-6 h-6 text-indigo-400" />
          Agent Settings
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Configure how your AI meeting assistant behaves.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2.5">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            Settings saved successfully.
          </div>
        )}

        {/* Display name */}
        <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-5">
          <label className="block text-sm font-medium text-slate-300 mb-3">
            Agent Display Name
          </label>
          <input
            type="text"
            value={prefs.agent_display_name ?? ""}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, agent_display_name: e.target.value }))
            }
            className="w-full bg-[#131c30] border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            placeholder="MeetBot"
          />
          <p className="text-xs text-slate-500 mt-1.5">
            How the agent appears in the meeting as a participant.
          </p>
        </div>

        {/* Mode */}
        <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-5">
          <label className="block text-sm font-medium text-slate-300 mb-3">
            Conversation Mode
          </label>
          <div className="space-y-2">
            {MODES.map(({ value, label, description }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPrefs((p) => ({ ...p, mode: value }))}
                className={clsx(
                  "w-full text-left px-4 py-3 rounded-xl border transition-colors",
                  prefs.mode === value
                    ? "border-indigo-600/60 bg-indigo-900/20"
                    : "border-slate-800 hover:border-slate-700 bg-transparent"
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={clsx(
                      "text-sm font-medium",
                      prefs.mode === value ? "text-indigo-300" : "text-slate-300"
                    )}
                  >
                    {label}
                  </span>
                  {prefs.mode === value && (
                    <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Tone */}
        <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-5">
          <label className="block text-sm font-medium text-slate-300 mb-3">
            Reply Tone
          </label>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPrefs((p) => ({ ...p, tone: t }))}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors",
                  prefs.tone === t
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Speak threshold */}
        <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-5">
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Speak Confidence Threshold
          </label>
          <p className="text-xs text-slate-500 mb-3">
            The agent will only speak if its confidence exceeds this value.
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={prefs.speak_threshold ?? 0.75}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  speak_threshold: parseFloat(e.target.value),
                }))
              }
              className="flex-1 accent-indigo-500"
            />
            <span className="text-sm font-mono text-slate-300 w-12 text-right">
              {((prefs.speak_threshold ?? 0.75) * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
        >
          {saving ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </form>
    </div>
  );
}
