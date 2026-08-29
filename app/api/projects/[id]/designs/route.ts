import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/** Dashboard: list a project's archived designs (metadata only, no HTML). */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const { data: project, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .single();

  if (error || !project) {
    return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });
  }

  const { data: designs, error: designsError } = await createServiceClient()
    .from("ai_designs")
    .select("id, brief, model, status, input_tokens, output_tokens, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(60);

  if (designsError) {
    return NextResponse.json(
      { success: false, error: "Could not load designs: " + designsError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, designs: designs ?? [] });
}
