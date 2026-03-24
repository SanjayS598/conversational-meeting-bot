import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Video,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Calendar,
  LayoutDashboard,
  ArrowLeft,
} from "lucide-react";
import type { MeetingSession } from "@/lib/types";
import clsx from "clsx";

function statusBadge(status: MeetingSession["status"]) {
  const map: Record<
    MeetingSession["status"],
    { label: string; color: string; icon: React.ReactNode }
  > = {
    created: {
      label: "Created",
      color: "text-slate-400 bg-slate-800",
      icon: <Clock className="w-3 h-3" />,
    },
    joining: {
      label: "Joining",
      color: "text-yellow-400 bg-yellow-900/30",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    joined: {
      label: "Live",
      color: "text-emerald-400 bg-emerald-900/30",
      icon: <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-pulse inline-block" />,
    },
    reconnecting: {
      label: "Reconnecting",
      color: "text-orange-400 bg-orange-900/30",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    failed: {
      label: "Failed",
      color: "text-red-400 bg-red-900/30",
      icon: <AlertCircle className="w-3 h-3" />,
    },
    ended: {
      label: "Ended",
      color: "text-slate-400 bg-slate-800",
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
  };
  const { label, color, icon } = map[status] ?? map.ended;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        color
      )}
    >
      {icon}
      {label}
    </span>
  );
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: meetings } = await supabase
    .from("meeting_sessions")
    .select("*")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(20);

  const activeMeetings = (meetings ?? []).filter((m: MeetingSession) =>
    ["joining", "joined", "reconnecting"].includes(m.status)
  );
  const pastMeetings = (meetings ?? []).filter(
    (m: MeetingSession) => !["joining", "joined", "reconnecting"].includes(m.status)
  );

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <LayoutDashboard className="w-6 h-6 text-[#6DD8F0]" />
            Dashboard
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Welcome back, {user.email?.split("@")[0]}!
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 border border-slate-700/80 bg-[#0d1628] hover:border-slate-600 hover:bg-slate-800/70 text-slate-200 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to Landing
          </Link>
          <Link
            href="/meetings/new"
            className="flex items-center gap-2 bg-[#3B82F6] hover:bg-[#4F94F8] text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Meeting
          </Link>
        </div>
      </div>

      {/* Active meetings */}
      {activeMeetings.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Active Sessions
          </h2>
          <div className="space-y-3">
            {activeMeetings.map((m: MeetingSession) => (
              <Link
                key={m.id}
                href={`/meetings/${m.id}/live`}
                className="flex items-center justify-between bg-emerald-900/10 border border-emerald-800/40 rounded-xl px-5 py-4 hover:border-emerald-700/60 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-emerald-900/40 flex items-center justify-center">
                    <Video className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium group-hover:text-emerald-300 transition-colors">
                      {m.meeting_url || "Meeting in progress"}
                    </p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {m.started_at
                        ? new Date(m.started_at).toLocaleString()
                        : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {statusBadge(m.status)}
                  <span className="text-slate-500 text-xs">View Live →</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Past meetings */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Past Meetings
        </h2>
        {pastMeetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border border-dashed border-slate-800 rounded-xl text-center">
            <Calendar className="w-10 h-10 text-slate-700 mb-3" />
            <p className="text-slate-400 font-medium">No meetings yet</p>
            <p className="text-slate-600 text-sm mt-1">
              Start your first meeting to see it here.
            </p>
            <Link
              href="/meetings/new"
              className="mt-5 text-sm text-[#6DD8F0] hover:text-[#97E8F7] font-medium"
            >
              + Start a meeting
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {pastMeetings.map((m: MeetingSession) => (
              <Link
                key={m.id}
                href={`/meetings/${m.id}/summary`}
                className="flex items-center justify-between bg-[#0d1628] border border-slate-800/60 rounded-xl px-5 py-4 hover:border-slate-700 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center">
                    <Video className="w-5 h-5 text-slate-400" />
                  </div>
                  <div>
                    <p className="text-slate-200 font-medium group-hover:text-white transition-colors">
                      {m.meeting_url || "Meeting"}
                    </p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {m.ended_at
                        ? new Date(m.ended_at).toLocaleString()
                        : m.started_at
                        ? new Date(m.started_at).toLocaleString()
                        : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {statusBadge(m.status)}
                  <span className="text-slate-600 text-xs group-hover:text-slate-400 transition-colors">
                    View Notes →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
