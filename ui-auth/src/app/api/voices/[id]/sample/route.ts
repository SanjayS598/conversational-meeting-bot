import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/voices/:id/sample
 * Accepts multipart/form-data with a `sample` audio file.
 * Forwards the file to the Voice Runtime service, which proxies it to ElevenLabs.
 * The frontend never holds the ElevenLabs API key.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify profile ownership
  const { data: profile } = await supabase
    .from("voice_profiles")
    .select("id, sample_count")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await req.formData();
  const sample = formData.get("sample");
  if (!(sample instanceof File)) {
    return NextResponse.json({ error: "sample file is required" }, { status: 400 });
  }

  const bytes = Buffer.from(await sample.arrayBuffer());
  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:4003";

  try {
    const vrRes = await callService(vrUrl, `/voices/${id}/sample`, {
      method: "POST",
      body: JSON.stringify({
        sample_name: sample.name,
        mime_type: sample.type || "audio/mpeg",
        audio_base64: bytes.toString("base64"),
      }),
    });

    if (!vrRes.ok) {
      const errBody = await vrRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errBody.error ?? "Voice service error" },
        { status: vrRes.status }
      );
    }
  } catch {
    // Voice service not available (dev mode) — still increment count
  }

  // Increment sample_count in DB
  const { data: updated, error } = await supabase
    .from("voice_profiles")
    .update({ sample_count: (profile.sample_count ?? 0) + 1 })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(updated);
}
