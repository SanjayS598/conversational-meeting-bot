import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";

function isMissingColumnError(message: string | undefined, column: string): boolean {
  if (!message) return false;
  return message.includes(`'${column}'`) && message.toLowerCase().includes("schema cache");
}

function isExistingProfileConstraintError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("duplicate key value violates unique constraint") &&
    lower.includes("voice_profiles_user_id_key")
  );
}

function withFallbackDisplayName<T extends { display_name?: string | null }>(
  profile: T,
  displayName: string
): T & { display_name: string } {
  return {
    ...profile,
    display_name: profile.display_name ?? displayName,
  };
}

async function ensureRuntimeEnrollment(
  vrUrl: string,
  userId: string,
  voiceProfileId: string,
  displayName: string
): Promise<void> {
  const existingRes = await callService(vrUrl, `/voices/${voiceProfileId}`, {
    method: "GET",
  });

  if (existingRes.ok) {
    return;
  }

  if (existingRes.status !== 404) {
    const errBody = await existingRes.json().catch(() => ({}));
    throw new Error(errBody.error ?? "Voice runtime lookup failed");
  }

  const enrollRes = await callService(vrUrl, "/voices/enroll", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      display_name: displayName,
      consent_confirmed: true,
      voice_profile_id: voiceProfileId,
    }),
  });

  if (!enrollRes.ok) {
    const errBody = await enrollRes.json().catch(() => ({}));
    throw new Error(errBody.error ?? "Voice runtime enrollment failed");
  }
}

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

  const displayName = String(body.display_name || "").trim() || `Voice ${new Date().toLocaleDateString()}`;

  let insertResult = await supabase
    .from("voice_profiles")
    .insert({
      user_id: user.id,
      provider: "elevenlabs",
      provider_voice_id: null,
      display_name: displayName,
      status: "pending",
      sample_count: 0,
      consent_confirmed: true,
    })
    .select()
    .single();

  if (isMissingColumnError(insertResult.error?.message, "display_name")) {
    insertResult = await supabase
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
  }

  if (isExistingProfileConstraintError(insertResult.error?.message)) {
    const existingResult = await supabase
      .from("voice_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (existingResult.error || !existingResult.data) {
      return NextResponse.json(
        { error: existingResult.error?.message ?? "Voice profile already exists" },
        { status: 409 }
      );
    }

    const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:4003";
    try {
      await ensureRuntimeEnrollment(vrUrl, user.id, existingResult.data.id, displayName);
    } catch (runtimeErr: unknown) {
      const message = runtimeErr instanceof Error ? runtimeErr.message : "Voice runtime enrollment failed";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json(withFallbackDisplayName(existingResult.data, displayName));
  }

  const { data, error } = insertResult;

  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed to create voice profile" }, { status: 500 });

  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:4003";
  try {
    await ensureRuntimeEnrollment(vrUrl, user.id, data.id, displayName);
  } catch (runtimeErr: unknown) {
    await supabase.from("voice_profiles").delete().eq("id", data.id);
    const message = runtimeErr instanceof Error ? runtimeErr.message : "Voice runtime enrollment failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json(withFallbackDisplayName(data, displayName), { status: 201 });
}
