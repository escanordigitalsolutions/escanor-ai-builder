import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { availablePages, colorwayCss, pickPage } from "@/lib/agent/design-pages";

/**
 * WordPress -> SaaS : everything needed to build a theme from a stored design.
 *
 * Designing is the expensive half of a generation — roughly fifty credits of a
 * ninety-credit run. Every one of those designs is already archived, so
 * rebuilding from one costs nothing beyond the build itself. Without this
 * endpoint the archive was a museum: you could look at a design you paid for
 * and had no way to use it again.
 *
 * The per-screen pieces are re-extracted from the stored documents rather than
 * kept twice. They were cut out with these same patterns when the design was
 * made, so a second copy in the database could only ever disagree with the
 * first.
 */

export const runtime = "nodejs";

function between(html: string, pattern: RegExp): string {
  const match = String(html || "").match(pattern);
  return match ? (match[1] ?? match[0]) : "";
}

/**
 * The site pages out of a stored direction.
 *
 * Read defensively: the archive holds directions written before pages existed,
 * and one of those must produce an empty list rather than a crash.
 */
function sitePagesOf(direction: unknown): { slug: string; title: string; purpose: string }[] {
  const raw = (direction as Record<string, unknown> | null)?.pages;
  if (!Array.isArray(raw)) return [];

  const out: { slug: string; title: string; purpose: string }[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const slug = String(row.slug ?? "").trim();
    if (!slug) continue;
    out.push({
      slug,
      title: String(row.title ?? slug).trim(),
      purpose: String(row.purpose ?? "").trim(),
    });
    if (out.length >= 7) break;
  }

  return out;
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request, { credits: false });

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

  if (!designId) {
    return NextResponse.json(
      { success: false, error: "A designId is required." },
      { status: 400 }
    );
  }

  const { data: design, error } = await createServiceClient()
    .from("ai_designs")
    .select("id, html, inner_html, pages, assets, direction, brief, concept, created_at")
    .eq("id", designId)
    .eq("project_id", auth.context.projectId)
    .single();

  if (error || !design) {
    return NextResponse.json({ success: false, error: "Design not found." }, { status: 404 });
  }

  const assets = (design.assets ?? {}) as Record<string, unknown>;
  const pages = (design.pages ?? {}) as Record<string, string>;

  if (!design.html || !assets.css) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This design predates the full archive and cannot be rebuilt — only its homepage was kept. Generate a new design instead.",
      },
      { status: 409 }
    );
  }

  const componentsCss = between(
    pages.components ?? "",
    /<style[^>]*data-part=["']components["'][^>]*>([\s\S]*?)<\/style>/i
  );

  const archiveCss = between(
    pages.archive ?? "",
    /<style[^>]*data-part=["']page["'][^>]*>([\s\S]*?)<\/style>/i
  );
  const archiveBody = between(
    pages.archive ?? "",
    /<main[^>]*data-part=["']page-body["'][\s\S]*?<\/main>/i
  );

  const notfoundCss = between(
    pages.notfound ?? "",
    /<style[^>]*data-part=["']page["'][^>]*>([\s\S]*?)<\/style>/i
  );
  const notfoundBody = between(
    pages.notfound ?? "",
    /<main[^>]*data-part=["']page-body["'][\s\S]*?<\/main>/i
  );

  // Every designed page, so a rebuild from the archive puts the same content
  // into WordPress that the person approved in the preview.
  const designed: Record<string, { title: string; css: string; body: string }> = {};

  for (const page of availablePages(design)) {
    if (page.slug === "home") continue;

    const html = pickPage(design, page.slug);
    if (!html) continue;

    designed[page.slug] = {
      title: page.label,
      css: between(html, /<style[^>]*data-part=["']page["'][^>]*>([\s\S]*?)<\/style>/i),
      body: between(html, /<main[^>]*data-part=["']page-body["'][\s\S]*?<\/main>/i),
    };
  }

  return NextResponse.json({
    success: true,
    designId: design.id,
    conceptName: design.concept ?? null,
    brief: design.brief ?? null,
    // The same shape the wizard receives from a fresh generation, so the build
    // path does not need to know where the design came from.
    css: assets.css ?? "",
    header: assets.header ?? "",
    footer: assets.footer ?? "",
    fonts: assets.fonts ?? [],
    sections: assets.sections ?? [],
    innerCss: assets.innerCss ?? "",
    pageHero: assets.pageHero ?? "",
    componentsCss,
    archiveCss,
    archiveBody,
    notfoundCss,
    notfoundBody,
    colorways: colorwayCss(design.direction),
    // A rebuild inherits the same nav the design was drawn with. Designs made
    // before the art director planned pages simply have none, and the build
    // falls back to planning its own — which is what it always did.
    sitePages: sitePagesOf(design.direction),
    // The pages themselves, keyed by slug.
    designedPages: designed,
    pagesCss: assets.pagesCss ?? "",
  });
}
