import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { LiveSessionState } from "@/lib/types";

interface Params {
  params: Promise<{ id: string }>;
}

/** GET /api/meetings/:id/live — polled by the live meeting page */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: session } = await supabase
    .from("meeting_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // During launch and failure states, return the session row only.
  // This avoids hammering Supabase with transcript/notes/action queries while the
  // page is waiting for the bot to settle into the call.
  if (["created", "joining", "failed"].includes(session.status)) {
    const state: LiveSessionState = {
      session,
      transcript: [],
      notes: null,
      action_items: [],
      agent_speaking: false,
      last_event: null,
    };

    return NextResponse.json(state);
  }

  const [
    { data: transcript },
    { data: notes },
    { data: actions },
    { data: events },
  ] = await Promise.all([
    supabase
      .from("transcript_segments")
      .select("*")
      .eq("session_id", id)
      .order("start_ms", { ascending: true })
      .limit(200),
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
      .from("agent_events")
      .select("*")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const lastEvent = events?.[0] ?? null;
  const agentSpeaking =
    lastEvent?.event_type === "audio.chunk.played" &&
    Date.now() - new Date(lastEvent.created_at).getTime() < 5000;

  const state: LiveSessionState = {
    session,
    transcript: transcript ?? [],
    notes: notes ?? null,
    action_items: actions ?? [],
    agent_speaking: agentSpeaking,
    last_event: lastEvent,
  };

  return NextResponse.json(state);
}
