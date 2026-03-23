import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/users/me/preferences */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    // Return sane defaults if no record exists yet
    return NextResponse.json({
      user_id: user.id,
      agent_display_name: "MeetBot",
      mode: "suggest_replies",
      tone: "professional",
      speak_threshold: 0.75,
      default_meeting_provider: "zoom",
      selected_voice_profile_id: null,
    });
  }

  return NextResponse.json(data);
}

/** PUT /api/users/me/preferences */
export async function PUT(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { agent_display_name, mode, tone, speak_threshold, default_meeting_provider, selected_voice_profile_id } =
    body;

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        agent_display_name,
        mode,
        tone,
        speak_threshold,
        default_meeting_provider,
        selected_voice_profile_id: selected_voice_profile_id ?? null,
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
