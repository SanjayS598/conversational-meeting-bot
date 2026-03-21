import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

/** GET /api/meetings/:id */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("meeting_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !data)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(data);
}
