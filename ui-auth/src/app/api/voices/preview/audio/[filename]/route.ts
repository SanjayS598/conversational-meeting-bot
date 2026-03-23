import { callService } from "@/lib/service-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/voices/preview/audio/[filename]
 *  Proxies a generated preview MP3 from the voice-cloning service. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { filename } = await params;
  // Sanitise: only alphanumeric, hyphens, underscores, and dot before extension
  if (!/^[\w-]+\.(mp3|json)$/.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:8083";
  const res = await callService(vrUrl, `/audio/${filename}`);

  if (!res.ok) {
    return NextResponse.json({ error: "Audio not found" }, { status: res.status });
  }

  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "audio/mpeg";

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
