import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isMissingColumnError(message: string | undefined, column: string): boolean {
  if (!message) return false;
  return message.includes(`'${column}'`) && message.toLowerCase().includes("schema cache");
}

interface Params {
  params: Promise<{ id: string }>;
}

/** POST /api/voices/:id/select */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("voice_profiles")
    .select("id, provider_voice_id, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (profile.status !== "ready" || !profile.provider_voice_id) {
    return NextResponse.json({ error: "Voice must be finalized before selection" }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        selected_voice_profile_id: id,
      },
      { onConflict: "user_id" }
    );

  if (error && !isMissingColumnError(error.message, "selected_voice_profile_id")) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, selected_voice_profile_id: id, current_voice_id: profile.provider_voice_id });
}