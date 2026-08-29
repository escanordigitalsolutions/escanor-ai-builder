import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/** Dashboard: one archived design — GET returns its HTML, DELETE removes it. */

async function authorize(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .single();
  return project ? user : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; designId: string }> }
) {
  const { id, designId } = await params;

  if (!(await authorize(id))) {
    return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  }

  const { data: design, error } = await createServiceClient()
    .from("ai_designs")
    .select("id, html, model, status, created_at")
    .eq("id", designId)
    .eq("project_id", id)
    .single();

  if (error || !design) {
    return NextResponse.json({ success: false, error: "Design not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, design });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; designId: string }> }
) {
  const { id, designId } = await params;

  if (!(await authorize(id))) {
    return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  }

  const { error } = await createServiceClient()
    .from("ai_designs")
    .delete()
    .eq("id", designId)
    .eq("project_id", id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
