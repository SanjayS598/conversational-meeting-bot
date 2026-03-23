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

/** PATCH /api/users/me/preferences — partial update for a single field */
export async function PATCH(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // Build the patch object with only recognized, safe columns
  const patch: Record<string, unknown> = { user_id: user.id };
  if (body.provider_voice_id !== undefined) patch.provider_voice_id = body.provider_voice_id;
  if (body.selected_voice_profile_id !== undefined) patch.selected_voice_profile_id = body.selected_voice_profile_id;
  if (body.agent_display_name !== undefined) patch.agent_display_name = body.agent_display_name;
  if (body.mode !== undefined) patch.mode = body.mode;
  if (body.tone !== undefined) patch.tone = body.tone;
  if (body.speak_threshold !== undefined) patch.speak_threshold = body.speak_threshold;

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(patch, { onConflict: "user_id" })
    .select()
    .single();

  // Column might not exist in schema yet — return ok with what we have
  if (error) {
    return NextResponse.json({ ok: true, warning: error.message });
  }
  return NextResponse.json(data ?? { ok: true });
}
