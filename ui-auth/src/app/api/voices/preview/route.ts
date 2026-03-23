import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** POST /api/voices/preview
 *  Body: { text: string; provider_voice_id?: string; voice_profile_id?: string }
 *  Synthesises a short speech sample and returns a URL to play it back. */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:8083";
  const res = await callService(vrUrl, "/voices/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    return NextResponse.json({ error: errBody.error ?? "Preview generation failed" }, { status: res.status });
  }

  const data = await res.json();
  // Expose a browser-accessible URL for the audio
  const audioUrl = data.audio_filename ? `/api/voices/preview/audio/${data.audio_filename}` : null;

  return NextResponse.json({ ...data, audio_url: audioUrl });
}
