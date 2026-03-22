import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callService } from "@/lib/service-client";
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

  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:8083";

  try {
    const vrRes = await callService(vrUrl, "/voices/enroll", {
      method: "POST",
      body: JSON.stringify({
        user_id: user.id,
        display_name: body.display_name ?? "My Voice",
        description: body.description ?? "",
        consent_confirmed: true,
      }),
    });

    const vrBody = await vrRes.json().catch(() => ({}));
    if (!vrRes.ok) {
      return NextResponse.json(
        { error: vrBody.error ?? "Voice enrollment failed" },
        { status: vrRes.status }
      );
    }

    return NextResponse.json(vrBody, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Voice service is unavailable" },
      { status: 503 }
    );
  }
}
