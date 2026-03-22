"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MarkdownDocument } from "@/components/MarkdownDocument";
import {
  Mic,
  Square,
  Loader2,
  AlertCircle,
  RefreshCw,
  ScrollText,
  ListChecks,
  FileText,
  Bot,
  Volume2,
} from "lucide-react";
import clsx from "clsx";
import type { LiveSessionState, TranscriptSegment, ActionItem } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

const STATUS_COLOR: Record<string, string> = {
  joining: "text-yellow-400",
  joined: "text-emerald-400",
  reconnecting: "text-orange-400",
  failed: "text-red-400",
  ended: "text-slate-400",
  created: "text-slate-400",
};

const STATUS_LABEL: Record<string, string> = {
  joining: "Joining…",
  joined: "Live",
  reconnecting: "Reconnecting…",
  failed: "Failed",
  ended: "Ended",
  created: "Starting…",
};

export default function LiveMeetingPage({ params }: Props) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<LiveSessionState | null>(null);
  const [tab, setTab] = useState<"transcript" | "notes" | "actions">("transcript");
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalizingRef = useRef(false);

  // Resolve params
  useEffect(() => {
    params.then((p) => setSessionId(p.id));
  }, [params]);

  const fetchLiveState = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/meetings/${id}/live`);
      if (!res.ok) throw new Error("Failed to fetch live state");
      const data: LiveSessionState = await res.json();
      setState(data);
      setError(null);
      // Redirect to summary if ended
      if (data.session.status === "ended" && !finalizingRef.current) {
        finalizingRef.current = true;
        if (pollRef.current) clearInterval(pollRef.current);
        try {
          await fetch(`/api/meetings/${id}/finalize`, { method: "POST" });
        } catch {
          // Automatic finalization may already be running server-side.
        }
        router.push(`/meetings/${id}/summary`);
      }
    } catch {
      setError("Lost connection — retrying…");
    }
  }, [router]);

  // Start session (if not already started) and begin polling
  useEffect(() => {
    if (!sessionId) return;

    async function init() {
      // Check current status first — if new meeting page already started it, skip the start call
      try {
        const check = await fetch(`/api/meetings/${sessionId}/live`);
        if (check.ok) {
          const data: LiveSessionState = await check.json();
          if (data.session.status === "created") {
            // Only start if session hasn't been kicked off yet
            await fetch(`/api/meetings/${sessionId}/start`, { method: "POST" }).catch(() => {});
          }
          setState(data);
        }
      } catch {
        // Fall back to trying start anyway
        await fetch(`/api/meetings/${sessionId}/start`, { method: "POST" }).catch(() => {});
      }
      pollRef.current = setInterval(() => fetchLiveState(sessionId!), 500);
    }

    init();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessionId, fetchLiveState]);

  // Auto-scroll transcript
  useEffect(() => {
    if (tab === "transcript") {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [state?.transcript, tab]);

  async function handleStop() {
    if (!sessionId) return;
    setStopping(true);
    try {
      await fetch(`/api/meetings/${sessionId}/stop`, { method: "POST" });
    } catch {
      setError("Failed to stop session.");
      setStopping(false);
    }
  }

  const session = state?.session;
  const status = session?.status ?? "created";

  return (
    <div className="flex flex-col h-screen bg-[#080e1c]">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 bg-[#0c1528] border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {status === "joined" && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 live-pulse" />
            )}
            {["joining", "reconnecting"].includes(status) && (
              <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
            )}
            {status === "failed" && (
              <AlertCircle className="w-4 h-4 text-red-400" />
            )}
            <span className={clsx("text-sm font-semibold", STATUS_COLOR[status])}>
              {STATUS_LABEL[status] ?? status}
            </span>
          </div>
          {session?.meeting_url && (
            <span className="text-slate-500 text-xs hidden md:block truncate max-w-xs">
              {session.meeting_url}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Agent speaking indicator */}
          {state?.agent_speaking && (
            <div className="flex items-center gap-1.5 text-[#6DD8F0] text-xs font-medium bg-[#6DD8F0]/10 border border-[#6DD8F0]/20 px-3 py-1.5 rounded-full">
              <Volume2 className="w-3 h-3" />
              Agent speaking
            </div>
          )}

          <button
            onClick={handleStop}
            disabled={stopping || status === "ended"}
            className="flex items-center gap-2 bg-red-900/40 hover:bg-red-700/50 border border-red-800/50 text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {stopping ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            Stop Listener
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-orange-400 bg-orange-900/20 border-b border-orange-800/30 px-6 py-2.5">
          <RefreshCw className="w-4 h-4 animate-spin" />
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Transcript / Notes / Actions panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-slate-800 px-6 flex-shrink-0">
            {(
              [
                { key: "transcript", label: "Transcript", icon: ScrollText },
                { key: "notes", label: "Notes", icon: FileText },
                { key: "actions", label: "Action Items", icon: ListChecks },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={clsx(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                  tab === key
                    ? "border-[#6DD8F0] text-[#6DD8F0]"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {key === "actions" &&
                  (state?.action_items?.length ?? 0) > 0 && (
                    <span className="ml-1 text-xs bg-[#3B82F6]/20 text-[#93C5FD] px-1.5 py-0.5 rounded-full">
                      {state!.action_items.length}
                    </span>
                  )}
              </button>
            ))}
          </div>

          {/* Panel body */}
          <div className="flex-1 overflow-y-auto p-6">
            {tab === "transcript" && (
              <TranscriptPanel
                segments={state?.transcript ?? []}
                agentSpeaking={state?.agent_speaking ?? false}
                endRef={transcriptEndRef}
              />
            )}
            {tab === "notes" && <NotesPanel notes={state?.notes ?? null} />}
            {tab === "actions" && (
              <ActionItemsPanel items={state?.action_items ?? []} />
            )}
          </div>
        </div>

        {/* Right: agent status sidebar */}
        <aside className="w-72 border-l border-slate-800 flex flex-col overflow-y-auto flex-shrink-0 bg-[#0c1528] p-5 space-y-5">
          <AgentStatusPanel state={state} />
        </aside>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TranscriptPanel({
  segments,
  agentSpeaking,
  endRef,
}: {
  segments: TranscriptSegment[];
  agentSpeaking: boolean;
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-16">
        <Mic className="w-10 h-10 text-slate-700 mb-3" />
        <p className="text-slate-400 font-medium">Waiting for audio…</p>
        <p className="text-slate-600 text-sm mt-1">
          Transcript segments will appear here in real time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {segments.map((seg) => (
        <div key={seg.id} className="slide-in flex gap-3">
          <div className="flex-shrink-0 w-16 text-right">
            <span className="text-xs text-slate-600 font-mono">
              {formatMs(seg.start_ms)}
            </span>
          </div>
          <div>
            <span className="text-xs font-semibold text-[#6DD8F0] mr-2">
              {seg.speaker}
            </span>
            <span className="text-slate-200 text-sm leading-relaxed">{seg.text}</span>
            {seg.confidence < 0.7 && (
              <span className="text-xs text-slate-600 ml-2">(?)</span>
            )}
          </div>
        </div>
      ))}

      {agentSpeaking && (
        <div className="slide-in flex gap-3">
          <div className="flex-shrink-0 w-16" />
          <div className="flex items-center gap-2 text-[#6DD8F0] text-sm">
            <Bot className="w-4 h-4" />
            <span className="italic">Agent is speaking…</span>
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1 h-1 bg-[#6DD8F0] rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </span>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}

function NotesPanel({ notes }: { notes: LiveSessionState["notes"] }) {
  if (!notes) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-16">
        <FileText className="w-10 h-10 text-slate-700 mb-3" />
        <p className="text-slate-400 font-medium">No notes yet</p>
        <p className="text-slate-600 text-sm mt-1">
          Meeting notes will be generated as the conversation progresses.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {notes.summary && (
        <section>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Summary
          </h3>
          <div className="text-slate-200 text-sm leading-relaxed bg-[#0d1628] border border-slate-800/60 rounded-xl p-4">
            <MarkdownDocument markdown={notes.summary} />
          </div>
        </section>
      )}

      {notes.decisions_json?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Decisions
          </h3>
          <ul className="space-y-2">
            {notes.decisions_json.map((d, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-200">
                <span className="text-emerald-400 mt-0.5">✓</span>
                {d}
              </li>
            ))}
          </ul>
        </section>
      )}

      {notes.questions_json?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Open Questions
          </h3>
          <ul className="space-y-2">
            {notes.questions_json.map((q, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-300">
                <span className="text-yellow-400 mt-0.5">?</span>
                {q}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ActionItemsPanel({ items }: { items: ActionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-16">
        <ListChecks className="w-10 h-10 text-slate-700 mb-3" />
        <p className="text-slate-400 font-medium">No action items yet</p>
        <p className="text-slate-600 text-sm mt-1">
          Action items will appear as the meeting identifies commitments.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-2xl">
      {items.map((item) => (
        <div
          key={item.id}
          className="bg-[#0d1628] border border-slate-800/60 rounded-xl p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-slate-200 text-sm">{item.description}</p>
            <span
              className={clsx(
                "flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full",
                item.status === "done"
                  ? "bg-emerald-900/30 text-emerald-400"
                  : "bg-yellow-900/30 text-yellow-400"
              )}
            >
              {item.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
            {item.owner && <span>Owner: {item.owner}</span>}
            {item.due_date && <span>Due: {item.due_date}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentStatusPanel({ state }: { state: LiveSessionState | null }) {
  const note = state?.notes;
  const lastEvent = state?.last_event;

  return (
    <>
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Agent Status
        </p>
        <div className="space-y-2">
          <StatusRow
            label="Session"
            value={state?.session.status ?? "—"}
            active={state?.session.status === "joined"}
          />
          <StatusRow
            label="Transcript lines"
            value={String(state?.transcript?.length ?? 0)}
          />
          <StatusRow
            label="Action items"
            value={String(state?.action_items?.length ?? 0)}
          />
        </div>
      </div>

      {note && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Current Topic
          </p>
          <p className="text-sm text-slate-300 bg-[#111828] border border-slate-800/60 rounded-lg p-3 leading-relaxed">
            {note.summary?.split(".")[0] ?? "—"}
          </p>
        </div>
      )}

      {lastEvent && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Last Event
          </p>
          <div className="bg-[#111828] border border-slate-800/60 rounded-lg p-3">
            <p className="text-xs text-[#6DD8F0] font-mono">{lastEvent.event_type}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {new Date(lastEvent.created_at).toLocaleTimeString()}
            </p>
          </div>
        </div>
      )}

      <div className="mt-auto pt-2 border-t border-slate-800">
        <p className="text-xs text-slate-600 text-center">
          Listen-only mode. Updates every 2 seconds.
        </p>
      </div>
    </>
  );
}

function StatusRow({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span
        className={clsx(
          "font-medium",
          active ? "text-emerald-400" : "text-slate-300"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
