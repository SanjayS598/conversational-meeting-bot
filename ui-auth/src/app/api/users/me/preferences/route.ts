import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isMissingColumnError(message: string | undefined, column: string): boolean {
  if (!message) return false;
  return message.includes(`'${column}'`) && message.toLowerCase().includes("schema cache");
}

function normalizeDisplayName(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "Clairo";
}

function normalizeTone(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "professional";
}

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
      user_full_name: null,
      agent_display_name: "Clairo",
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
  const { user_full_name, agent_display_name, mode, tone, speak_threshold, default_meeting_provider, selected_voice_profile_id } =
    body;

  const payload = {
    user_id: user.id,
    user_full_name: user_full_name ?? null,
    agent_display_name: normalizeDisplayName(agent_display_name),
    mode,
    tone: normalizeTone(tone),
    speak_threshold,
    default_meeting_provider,
    selected_voice_profile_id: selected_voice_profile_id ?? null,
  };

  let { data, error } = await supabase
    .from("user_preferences")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();

  if (error && isMissingColumnError(error.message, "selected_voice_profile_id")) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.selected_voice_profile_id;
    const retry = await supabase
      .from("user_preferences")
      .upsert(fallbackPayload, { onConflict: "user_id" })
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

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
  if (body.user_full_name !== undefined) patch.user_full_name = body.user_full_name;
  if (body.provider_voice_id !== undefined) patch.provider_voice_id = body.provider_voice_id;
  if (body.selected_voice_profile_id !== undefined) patch.selected_voice_profile_id = body.selected_voice_profile_id;
  if (body.agent_display_name !== undefined) patch.agent_display_name = normalizeDisplayName(body.agent_display_name);
  if (body.mode !== undefined) patch.mode = body.mode;
  if (body.tone !== undefined) patch.tone = normalizeTone(body.tone);
  if (body.speak_threshold !== undefined) patch.speak_threshold = body.speak_threshold;

  let { data, error } = await supabase
    .from("user_preferences")
    .upsert(patch, { onConflict: "user_id" })
    .select()
    .single();

  if (error && isMissingColumnError(error.message, "selected_voice_profile_id")) {
    const fallbackPatch = { ...patch };
    delete fallbackPatch.selected_voice_profile_id;
    const retry = await supabase
      .from("user_preferences")
      .upsert(fallbackPatch, { onConflict: "user_id" })
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  // Column might not exist in schema yet — return ok with what we have
  if (error) {
    return NextResponse.json({ ok: true, warning: error.message });
  }
  return NextResponse.json(data ?? { ok: true });
}
