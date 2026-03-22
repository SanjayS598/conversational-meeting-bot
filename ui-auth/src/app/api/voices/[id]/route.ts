import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callService } from "@/lib/service-client";
import { NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

/** GET /api/voices/:id */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vrUrl = process.env.VOICE_RUNTIME_URL ?? "http://localhost:8083";

  try {
    const vrRes = await callService(vrUrl, `/voices/${id}`, { method: "GET" });
    const body = await vrRes.json().catch(() => ({}));
    if (!vrRes.ok) {
      return NextResponse.json(
        { error: body.error ?? "Not found" },
        { status: vrRes.status }
      );
    }

    if (body.user_id !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "Voice service unavailable" }, { status: 503 });
  }
}
