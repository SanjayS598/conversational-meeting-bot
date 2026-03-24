import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isMissingColumnError(message: string | undefined, column: string): boolean {
  if (!message) return false;
  return message.includes(`'${column}'`) && message.toLowerCase().includes("schema cache");
}

/** GET /api/voices/me — list the current user's saved voices and active selection */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: voices, error: voiceError }, prefsResult] = await Promise.all([
    supabase
      .from("voice_profiles")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("user_preferences")
      .select("selected_voice_profile_id, provider_voice_id")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (voiceError) {
    return NextResponse.json({ error: voiceError.message }, { status: 500 });
  }

  const items = (voices ?? []).map((item, index) => ({
    ...item,
    display_name: item.display_name ?? `Voice ${index + 1}`,
  }));
  const selectedVoiceProfileId = isMissingColumnError(
    prefsResult.error?.message,
    "selected_voice_profile_id"
  )
    ? null
    : prefsResult.data?.selected_voice_profile_id ?? null;
  const selectedProfile = items.find((item) => item.id === selectedVoiceProfileId) ?? null;
  const currentVoiceId = selectedProfile?.provider_voice_id
    ?? prefsResult.data?.provider_voice_id
    ?? process.env.ELEVENLABS_VOICE_ID
    ?? null;

  return NextResponse.json({
    items,
    selected_voice_profile_id: selectedVoiceProfileId,
    current_voice_profile_id: selectedProfile?.id ?? null,
    current_voice_id: currentVoiceId,
  });
}
