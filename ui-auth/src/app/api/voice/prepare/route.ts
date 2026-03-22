/**
 * POST /api/voice/prepare
 *
 * Browser-facing proxy for the gemini-backend POST /voice/prepare endpoint.
 * Accepts multipart/form-data with:
 *   - display_name  (string, required)
 *   - personal_notes (string, optional)
 *   - files[]       (PDF / PPTX / TXT / MD, optional)
 *
 * Returns: { prep_id, greeting, docs, context_length }
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // Auth check — only authenticated users may prepare an agent
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Forward the multipart form body directly to gemini-backend
  const brainUrl =
    process.env.GEMINI_SERVICE_URL ?? "http://localhost:3002";

  try {
    const formData = await req.formData();

    const upstream = await fetch(`${brainUrl}/voice/prepare`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN ?? ""}`,
        // Do NOT set Content-Type — let fetch set it with the correct boundary
      },
      body: formData,
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return NextResponse.json(
        { error: data?.detail ?? "Voice preparation failed" },
        { status: upstream.status }
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
