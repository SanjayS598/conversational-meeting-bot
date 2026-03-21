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

  // Mark session as ended
  await supabase
    .from("meeting_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", id);

  // Tell Meeting Gateway to stop
  const gwUrl = process.env.MEETING_GATEWAY_URL ?? "http://localhost:4001";
  callService(gwUrl, `/sessions/${id}/stop`, { method: "POST" }).catch(() => {});

  // Tell voice runtime to cancel any active speech
  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:4003";
  callService(vrUrl, `/runtime/sessions/${id}/cancel`, { method: "POST" }).catch(
    () => {}
  );

  await supabase.from("agent_events").insert({
    session_id: id,
    event_type: "session.stop_requested",
    payload_json: { initiated_by: user.id },
  });

  return NextResponse.json({ ok: true });
}
