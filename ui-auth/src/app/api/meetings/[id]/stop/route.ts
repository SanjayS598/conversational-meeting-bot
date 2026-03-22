import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

/** POST /api/meetings/:id/stop */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: session } = await supabase
    .from("meeting_sessions")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Tell Meeting Gateway to stop
  const gwUrl = process.env.MEETING_GATEWAY_URL ?? "http://localhost:3001";
  const gatewayResponse = await callService(gwUrl, `/sessions/${id}/stop`, {
    method: "POST",
  });

  if (!gatewayResponse.ok && gatewayResponse.status !== 404) {
    const body = await gatewayResponse.text();
    return NextResponse.json(
      { error: body || "Failed to stop meeting gateway session" },
      { status: gatewayResponse.status }
    );
  }

  // Always mark the session as ended in the DB — covers the case where the
  // gateway returned 404 (session not in memory after a restart) so the live
  // page stops polling.
  await supabase
    .from("meeting_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", id);

  await supabase.from("agent_events").insert({
    session_id: id,
    event_type: "session.stop_requested",
    payload_json: { initiated_by: user.id },
  });

  return NextResponse.json({ ok: true });
}
