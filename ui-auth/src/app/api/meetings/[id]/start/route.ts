import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

/** POST /api/meetings/:id/start */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch session and verify ownership
  const { data: session, error: fetchErr } = await supabase
    .from("meeting_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Mark session as joining
  await supabase
    .from("meeting_sessions")
    .update({ status: "joining", started_at: new Date().toISOString() })
    .eq("id", id);

  // Fetch user preferences for agent config
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();

  // Fetch voice profile
  const { data: voice } = await supabase
    .from("voice_profiles")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "ready")
    .single();

  // Fire-and-forget: tell the Meeting Gateway to join
  const gwUrl = process.env.MEETING_GATEWAY_URL ?? "http://localhost:3001";
  callService(gwUrl, "/sessions/start", {
    method: "POST",
    body: JSON.stringify({
      meeting_session_id: id,
      user_id: user.id,
      meeting_url: session.meeting_url,
      agent_config: prefs ?? {},
      voice_profile_id: voice?.id ?? null,
    }),
  }).catch(() => {
    // Best-effort; gateway may not be running locally during dev
  });

  // Record an agent event
  await supabase.from("agent_events").insert({
    session_id: id,
    event_type: "session.start_requested",
    payload_json: { initiated_by: user.id },
  });

  return NextResponse.json({ ok: true });
}
