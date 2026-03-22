import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";

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

  // Ask voice runtime to finalize (it calls ElevenLabs)
  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:4003";

  try {
    const vrRes = await callService(vrUrl, `/voices/${id}/finalize`, {
      method: "POST",
    });

    if (!vrRes.ok) {
      const errBody = await vrRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errBody.error ?? "Voice service finalize failed" },
        { status: vrRes.status }
      );
    }

    const body = await vrRes.json();
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
