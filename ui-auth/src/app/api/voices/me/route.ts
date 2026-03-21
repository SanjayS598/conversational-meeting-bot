import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/voices/me — convenience endpoint to get the current user's voice profile */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("voice_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
