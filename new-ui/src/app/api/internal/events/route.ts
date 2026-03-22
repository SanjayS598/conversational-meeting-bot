import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * POST /api/internal/events
 * Called by Meeting Gateway, Gemini Intelligence, and Voice Runtime
 * to push events, transcript segments, notes, and status updates.
 *
 * Protected by the shared INTERNAL_SERVICE_TOKEN — never exposed to the browser.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  if (!token || token !== process.env.INTERNAL_SERVICE_TOKEN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { type, payload } = body;

  if (!type || !payload) {
    return NextResponse.json({ error: "type and payload required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  switch (type) {
    case "session.status": {
      const { session_id, status } = payload;
      await supabase
        .from("meeting_sessions")
        .update({ status })
        .eq("id", session_id);
      break;
    }

    case "transcript.segment": {
      const { session_id, speaker, text, start_ms, end_ms, confidence } = payload;
      await supabase.from("transcript_segments").insert({
        session_id,
        speaker,
        text,
        start_ms,
        end_ms,
        confidence,
      });
      break;
    }

    case "notes.update": {
      const { session_id, summary, decisions_json, questions_json } = payload;
      await supabase.from("meeting_notes").upsert(
        { session_id, summary, decisions_json, questions_json },
        { onConflict: "session_id" }
      );
      break;
    }

    case "action_item.create": {
      const { session_id, owner, description, due_date } = payload;
      await supabase.from("action_items").insert({
        session_id,
        owner,
        description,
        due_date: due_date ?? null,
        status: "open",
      });
      break;
    }

    case "agent.event": {
      const { session_id, event_type, payload_json } = payload;
      await supabase.from("agent_events").insert({
        session_id,
        event_type,
        payload_json: payload_json ?? {},
      });
      break;
    }

    default:
      return NextResponse.json({ error: `Unknown event type: ${type}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
