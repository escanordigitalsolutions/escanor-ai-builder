import { NextRequest, NextResponse } from "next/server";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * WordPress -> SaaS : one archived design's HTML for the wp-admin preview.
 *
 * `which` picks the homepage or the inner page. Before the archive stored the
 * inner page there was nothing to pick between, which is why the wp-admin
 * archive only ever showed one screen per design.
 */

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const designId = typeof body.designId === "string" ? body.designId.trim() : "";
  const which = body.which === "inner" ? "inner" : "home";

  if (!designId) {
    return NextResponse.json(
      { success: false, error: "A designId is required." },
      { status: 400 }
    );
  }

  const { data: design, error } = await createServiceClient()
    .from("ai_designs")
    .select("id, html, inner_html")
    .eq("id", designId)
    .eq("project_id", auth.context.projectId)
    .single();

  if (error || !design) {
    return NextResponse.json({ success: false, error: "Design not found." }, { status: 404 });
  }

  const inner = (design.inner_html as string | null) ?? "";

  if (which === "inner" && !inner) {
    return NextResponse.json(
      {
        success: false,
        error: "This design has no inner page — it was generated before inner pages were kept, or that stage was skipped.",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    which,
    html: which === "inner" ? inner : design.html,
    hasInner: Boolean(inner),
  });
}
