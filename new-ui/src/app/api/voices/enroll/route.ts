import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** POST /api/voices/enroll */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.consent_confirmed) {
    return NextResponse.json(
      { error: "consent_confirmed must be true" },
      { status: 400 }
    );
  }

  // Check if a profile already exists
  const { data: existing } = await supabase
    .from("voice_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "Voice profile already exists" },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("voice_profiles")
    .insert({
      user_id: user.id,
      provider: "elevenlabs",
      provider_voice_id: null,
      status: "pending",
      sample_count: 0,
      consent_confirmed: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
