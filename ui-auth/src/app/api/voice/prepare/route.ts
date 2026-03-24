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

    // Inject the authenticated user's real name so the greeting can reference
    // who sent the agent ("I am an AI agent sent by <sender_name>")
    // 1. Try user_full_name from preferences (most reliable — user-entered)
    // 2. Fall back to OAuth metadata, then email prefix
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("user_full_name")
      .eq("user_id", user.id)
      .single();

    const senderName: string =
      (prefs?.user_full_name as string | undefined) ||
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      user.email?.split("@")[0] ||
      "your host";
    formData.set("sender_name", senderName);

    const upstream = await fetch(`${brainUrl}/voice/prepare`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN ?? ""}`,
        // Do NOT set Content-Type — let fetch set it with the correct boundary
      },
      body: formData,
    });

    const text = await upstream.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text);
    } catch {
      // non-JSON error body from upstream
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: (data?.detail as string) ?? text ?? "Voice preparation failed" },
        { status: upstream.status }
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
