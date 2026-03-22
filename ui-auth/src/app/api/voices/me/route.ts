import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";

/** GET /api/voices/me — fetch current user's saved voices from the voice service */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:8083";

  try {
    const [voicesRes, defaultRes] = await Promise.all([
      callService(vrUrl, `/users/${user.id}/voices`, { method: "GET" }),
      callService(vrUrl, `/users/${user.id}/voices/default`, { method: "GET" }),
    ]);

    const voicesBody = await voicesRes.json().catch(() => ({ items: [] }));
    const defaultBody = defaultRes.ok ? await defaultRes.json().catch(() => null) : null;

    return NextResponse.json({
      items: voicesBody.items ?? [],
      active_voice: defaultBody,
    });
  } catch {
    return NextResponse.json({ items: [], active_voice: null });
  }
}
