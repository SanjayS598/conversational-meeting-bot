import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

/** GET /api/meetings/:id/summary */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [
    { data: session },
    { data: notes },
    { data: actions },
    { data: transcript },
  ] = await Promise.all([
    supabase
      .from("meeting_sessions")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single(),
    supabase.from("meeting_notes").select("*").eq("session_id", id).single(),
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

  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ session, notes, action_items: actions, transcript });
}
