import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";

function isMissingColumnError(message: string | undefined, column: string): boolean {
  if (!message) return false;
  return message.includes(`'${column}'`) && message.toLowerCase().includes("schema cache");
}

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/voices/:id/finalize
 * Tells the Voice Runtime to trigger ElevenLabs instant voice cloning.
 * ElevenLabs API key is held server-side in the Voice Runtime only.
 */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("voice_profiles")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if ((profile.sample_count ?? 0) < 1) {
    return NextResponse.json(
      { error: "Upload at least one voice sample first" },
      { status: 400 }
    );
  }

  // Ask voice runtime to finalize (it calls ElevenLabs)
  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:4003";
  let providerVoiceId: string | null = null;

  try {
    const vrRes = await callService(vrUrl, `/voices/${id}/finalize`, {
      method: "POST",
      body: JSON.stringify({ user_id: user.id }),
    });

    if (vrRes.ok) {
      const body = await vrRes.json();
      providerVoiceId = body.provider_voice_id ?? null;
    }
  } catch {
    // Dev mode: finalize without real ElevenLabs call
  }

  // Update profile status to ready
  const { data, error } = await supabase
    .from("voice_profiles")
    .update({
      status: "ready",
      provider_voice_id: providerVoiceId,
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed to finalize voice" }, { status: 500 });

  const autoSelectResult = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        selected_voice_profile_id: id,
      },
      { onConflict: "user_id" }
    );

  if (
    autoSelectResult.error &&
    !isMissingColumnError(autoSelectResult.error.message, "selected_voice_profile_id")
  ) {
    return NextResponse.json({ error: autoSelectResult.error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
