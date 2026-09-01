import { NextRequest, NextResponse } from "next/server";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  availablePages,
  missingMessage,
  pickPage,
  resolvePage,
} from "@/lib/agent/design-pages";

/**
 * WordPress -> SaaS : one archived design's HTML for the wp-admin preview.
 *
 * `which` is a page slug — "home", or any page this design holds. It used to be
 * one of six fixed names, three of which were not pages at all, which is why a
 * design's own About and Services could not be previewed.
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
  const which = resolvePage(body.which);

  if (!designId) {
    return NextResponse.json(
      { success: false, error: "A designId is required." },
      { status: 400 }
    );
  }

  const { data: design, error } = await createServiceClient()
    .from("ai_designs")
    .select("id, html, inner_html, pages, direction")
    .eq("id", designId)
    .eq("project_id", auth.context.projectId)
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

  return NextResponse.json({ success: true, which, html, available });

}
