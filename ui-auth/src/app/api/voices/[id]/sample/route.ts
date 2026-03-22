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

  const formData = await req.formData();
  const sample = formData.get("sample");
  if (!(sample instanceof File)) {
    return NextResponse.json({ error: "Audio file is required" }, { status: 400 });
  }

  const buffer = Buffer.from(await sample.arrayBuffer());
  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:4003";

  try {
    let vrRes = await sendSampleToVoiceRuntime(vrUrl, id, sample, buffer);

    if (vrRes.status === 404) {
      return NextResponse.json(
        { error: "Voice profile not found. Create a voice first." },
        { status: 404 }
      );
    }

    if (!vrRes.ok) {
      const errBody = await vrRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errBody.error ?? "Voice service error" },
        { status: vrRes.status }
      );
    }
    const body = await vrRes.json().catch(() => ({}));
    if (body.user_id !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(body);
  } catch {
    return NextResponse.json(
      { error: "Voice service unavailable" },
      { status: 503 }
    );
  }
}

function sendSampleToVoiceRuntime(
  vrUrl: string,
  id: string,
  sample: File,
  buffer: Buffer
) {
  return callService(vrUrl, `/voices/${id}/sample`, {
    method: "POST",
    body: JSON.stringify({
      sample_name: sample.name,
      mime_type: sample.type || "application/octet-stream",
      audio_base64: buffer.toString("base64"),
    }),
  });
}
