import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";

/** POST /api/voices/preview — generate preview audio for a saved voice */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:8083";

  try {
    const vrRes = await callService(vrUrl, "/voices/preview", {
      method: "POST",
      body: JSON.stringify({
        voice_profile_id: body.voice_profile_id,
        text: body.text,
      }),
    });

    const preview = await vrRes.json().catch(() => ({}));
    if (!vrRes.ok) {
      return NextResponse.json(
        { error: preview.error ?? "Preview generation failed" },
        { status: vrRes.status }
      );
    }

    const audioFilename = String(preview.audio_ref ?? "").split("\\").pop();

    return NextResponse.json({
      ...preview,
      audio_url: audioFilename ? `${vrUrl.replace(/\/$/, "")}/audio/${audioFilename}` : null,
    });
  } catch {
    return NextResponse.json(
      { error: "Voice service unavailable" },
      { status: 503 }
    );
  }
}
