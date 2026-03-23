import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** GET /api/voices/library?category=all|premade|cloned
 *  Proxies to voice-cloning /voices/library and returns the ElevenLabs voice list. */
export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") ?? "all";

  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:8083";
  const res = await callService(vrUrl, `/voices/library?category=${encodeURIComponent(category)}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return NextResponse.json({ error: body.error ?? "Failed to fetch voice library" }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
