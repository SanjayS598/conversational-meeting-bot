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

  // Parse optional body params (passcode, objective, prep notes, voice agent)
  let passcode: string | undefined;
  let meeting_objective: string | undefined;
  let prep_notes: string | undefined;
  let prep_id: string | undefined;
  let bot_display_name: string | undefined;
  try {
    const body = await _req.json().catch(() => ({}));
    passcode = body.passcode || undefined;
    meeting_objective = body.meeting_objective || undefined;
    prep_notes = body.prep_notes || undefined;
    prep_id = body.prep_id || undefined;
    bot_display_name = body.bot_display_name || undefined;
  } catch {
    // Body is optional — ignore parse errors
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

  // Tell the Meeting Gateway to join
  const gwUrl = process.env.MEETING_GATEWAY_URL ?? "http://localhost:3001";
  let gatewayResponse: Response;
  try {
    gatewayResponse = await callService(gwUrl, "/sessions/start", {
      method: "POST",
      body: JSON.stringify({
        meeting_session_id: id,
        user_id: user.id,
        meeting_url: session.meeting_url,
        bot_display_name: bot_display_name ?? prefs?.agent_display_name ?? undefined,
        passcode,
        meeting_objective,
        prep_notes,
        prep_id,
      }),
    });
  } catch (err: unknown) {
    await supabase
      .from("meeting_sessions")
      .update({ status: "failed" })
      .eq("id", id);
    const msg = err instanceof Error ? err.message : "Meeting gateway unreachable";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!gatewayResponse.ok) {
    await supabase
      .from("meeting_sessions")
      .update({ status: "failed" })
      .eq("id", id);

    const body = await gatewayResponse.text();
    return NextResponse.json(
      { error: body || "Failed to start meeting gateway session" },
      { status: gatewayResponse.status }
    );
  }

  // Record an agent event
  await supabase.from("agent_events").insert({
    session_id: id,
    event_type: "session.start_requested",
    payload_json: { initiated_by: user.id, mode: "notes_only" },
  });

  return NextResponse.json({ ok: true });
}
