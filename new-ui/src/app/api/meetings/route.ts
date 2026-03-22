import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** POST /api/meetings — create a new meeting session */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { meeting_url, provider = "zoom" } = body;

  if (!meeting_url) {
    return NextResponse.json({ error: "meeting_url is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("meeting_sessions")
    .insert({
      user_id: user.id,
      provider,
      meeting_url,
      status: "created",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

/** GET /api/meetings — list current user's meetings */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("meeting_sessions")
    .select("*")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
