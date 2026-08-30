import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  availablePages,
  missingMessage,
  pickPage,
  resolvePage,
} from "@/lib/agent/design-pages";

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
  request: Request,
  { params }: { params: Promise<{ id: string; designId: string }> }
) {
  const { id, designId } = await params;

  // A design has two screens: the homepage and the representative inner page.
  // Until the archive kept the second one there was nothing to choose between.
  const which = resolvePage(new URL(request.url).searchParams.get("which"));

  if (!(await authorize(id))) {
    return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  }

  const { data: design, error } = await createServiceClient()
    .from("ai_designs")
    .select("id, html, inner_html, pages, concept, critique, model, status, created_at")
    .eq("id", designId)
    .eq("project_id", id)
    .single();

  if (error || !design) {
    return NextResponse.json({ success: false, error: "Design not found." }, { status: 404 });
  }

  const html = pickPage(design, which);
  const available = availablePages(design);

  if (!html) {
    return NextResponse.json(
      { success: false, error: missingMessage(which), available },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    which,
    available,
    design: {
      id: design.id,
      html,
      concept: design.concept,
      critique: design.critique,
      model: design.model,
      status: design.status,
      created_at: design.created_at,
    },
  });
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
