import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { finalizeMeetingSummary } from "@/lib/meeting-finalizer";
import { NextResponse } from "next/server";

/**
 * POST /api/internal/gateway/events
 * Called by the Meeting Gateway (zoom-gateway) to push session status changes.
 *
 * Body: { session_id, status, meeting_id?, joined_at?, ended_at?, error? }
 * Protected by the x-internal-token header or Authorization: Bearer header.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const xToken = req.headers.get("x-internal-token") ?? "";
  const token = authHeader.replace("Bearer ", "") || xToken;

  if (!token || token !== process.env.INTERNAL_SERVICE_TOKEN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { session_id, status, error: sessionError } = body;

  if (!session_id || !status) {
    return NextResponse.json({ error: "session_id and status are required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const update: Record<string, unknown> = { status };
  if (body.joined_at) update.started_at = body.joined_at;
  if (body.ended_at) update.ended_at = body.ended_at;

  console.log(`[gateway/events] Updating session ${session_id} → status=${status}`);
  const { error: updateErr } = await supabase
    .from("meeting_sessions")
    .update(update)
    .eq("id", session_id);

  if (updateErr) {
    console.error(`[gateway/events] Supabase update failed session=${session_id}:`, updateErr);
  } else {
    console.log(`[gateway/events] Supabase update OK session=${session_id} status=${status}`);
  }

  // Record as an agent event for audit trail
  await supabase.from("agent_events").insert({
    session_id,
    event_type: `gateway.${status}`,
    payload_json: { error: sessionError ?? null },
  });

  if (status === "ended") {
    try {
      await finalizeMeetingSummary(session_id);
    } catch (error) {
      await supabase.from("agent_events").insert({
        session_id,
        event_type: "summary.finalize_failed",
        payload_json: {
          error: error instanceof Error ? error.message : "Unknown summary finalization error",
        },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
