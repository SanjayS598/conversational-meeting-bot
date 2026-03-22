import { MarkdownDocument } from "@/components/MarkdownDocument";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  HelpCircle,
  ListChecks,
  FileText,
  ArrowLeft,
  Clock,
  CalendarDays,
} from "lucide-react";
import type { ActionItem, MeetingNote, TranscriptSegment } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function MeetingSummaryPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: session } = await supabase
    .from("meeting_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();

  if (!session) notFound();

  const [{ data: notes }, { data: actions }, { data: transcript }] =
    await Promise.all([
      supabase
        .from("meeting_notes")
        .select("*")
        .eq("session_id", id)
        .single(),
      supabase
        .from("action_items")
        .select("*")
        .eq("session_id", id)
        .order("due_date", { ascending: true }),
      supabase
        .from("transcript_segments")
        .select("*")
        .eq("session_id", id)
        .order("start_ms", { ascending: true }),
    ]);

  const note = notes as MeetingNote | null;
  const items = (actions ?? []) as ActionItem[];
  const segments = (transcript ?? []) as TranscriptSegment[];

  const duration =
    session.started_at && session.ended_at
      ? Math.round(
          (new Date(session.ended_at).getTime() -
            new Date(session.started_at).getTime()) /
            60000
        )
      : null;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Back */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="bg-[#0d1424] border border-slate-800 rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-white mb-1">Meeting Summary</h1>
            <p className="text-slate-400 text-sm truncate max-w-lg">
              {session.meeting_url || "Zoom Meeting"}
            </p>
          </div>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-800 text-slate-400">
            {session.status}
          </span>
        </div>

        <div className="flex items-center gap-5 mt-4 text-sm text-slate-500">
          {session.started_at && (
            <div className="flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4" />
              {new Date(session.started_at).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          )}
          {duration !== null && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {duration} min
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            {segments.length} transcript lines
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left col: summary + decisions + questions */}
        <div className="lg:col-span-2 space-y-5">
          {/* Summary */}
          <section className="bg-[#0d1424] border border-slate-800 rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
              <FileText className="w-4 h-4 text-indigo-400" />
              Summary
            </h2>
            {note?.summary ? (
              <div>
                <MarkdownDocument markdown={note.summary} />
              </div>
            ) : (
              <p className="text-slate-500 text-sm italic">No summary available.</p>
            )}
          </section>

          {/* Decisions */}
          <section className="bg-[#0d1424] border border-slate-800 rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Decisions
            </h2>
            {note?.decisions_json?.length ? (
              <ul className="space-y-2">
                {note.decisions_json.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    {d}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500 text-sm italic">No decisions recorded.</p>
            )}
          </section>

          {/* Open questions */}
          <section className="bg-[#0d1424] border border-slate-800 rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
              <HelpCircle className="w-4 h-4 text-yellow-400" />
              Open Questions
            </h2>
            {note?.questions_json?.length ? (
              <ul className="space-y-2">
                {note.questions_json.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-200">
                    <HelpCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    {q}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500 text-sm italic">No open questions.</p>
            )}
          </section>

          {/* Transcript */}
          {segments.length > 0 && (
            <section className="bg-[#0d1424] border border-slate-800 rounded-2xl p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
                <FileText className="w-4 h-4 text-slate-400" />
                Full Transcript
              </h2>
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {segments.map((seg) => (
                  <div key={seg.id} className="flex gap-3 text-sm">
                    <span className="text-xs text-slate-600 font-mono w-12 flex-shrink-0 pt-0.5">
                      {formatMs(seg.start_ms)}
                    </span>
                    <div>
                      <span className="text-xs font-semibold text-indigo-400 mr-2">
                        {seg.speaker}
                      </span>
                      <span className="text-slate-300">{seg.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right col: action items */}
        <div className="space-y-5">
          <section className="bg-[#0d1424] border border-slate-800 rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
              <ListChecks className="w-4 h-4 text-indigo-400" />
              Action Items
              {items.length > 0 && (
                <span className="ml-auto text-xs bg-indigo-900/40 text-indigo-400 px-2 py-0.5 rounded-full">
                  {items.length}
                </span>
              )}
            </h2>
            {items.length === 0 ? (
              <p className="text-slate-500 text-sm italic">No action items.</p>
            ) : (
              <ul className="space-y-3">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="border border-slate-800 rounded-lg p-3 space-y-1"
                  >
                    <p className="text-sm text-slate-200">{item.description}</p>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{item.owner || "Unassigned"}</span>
                      <span
                        className={
                          item.status === "done"
                            ? "text-emerald-400"
                            : "text-yellow-400"
                        }
                      >
                        {item.status}
                      </span>
                    </div>
                    {item.due_date && (
                      <p className="text-xs text-slate-600">Due: {item.due_date}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
