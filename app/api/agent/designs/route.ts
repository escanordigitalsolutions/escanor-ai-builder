import { NextRequest, NextResponse } from "next/server";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { availablePages } from "@/lib/agent/design-pages";

/** WordPress -> SaaS : list the project's archived designs (metadata only). */

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request, { credits: false });

  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { data: designs, error } = await createServiceClient()
    .from("ai_designs")
    .select(
      "id, brief, model, status, concept, shape, retried, critique, inner_html, pages, assets, direction, input_tokens, output_tokens, created_at"
    )
    .eq("project_id", auth.context.projectId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json(
      { success: false, error: "Could not load designs: " + error.message },
      { status: 500 }
    );
  }

  // inner_html is a large column and the list only needs to know whether one
  // exists, so it is reduced to a flag before the response is built.
  // Flags, not payloads. The list only needs to know which screens exist and
  // whether the design can be rebuilt; the documents themselves are fetched
  // one at a time when someone actually opens one.
  const rows = (designs ?? []).map((row) => {
    const { inner_html, pages, assets, direction, ...rest } = row as Record<string, unknown>;
    const parts = (assets ?? {}) as Record<string, unknown>;
    const thumb = (parts.thumb ?? null) as { version?: number } | null;

    return {
      ...rest,
      hasInner: Boolean(inner_html),
      // The same list every other reader uses — this was still the fixed six
      // long after designs stopped holding six fixed screens, so dashboard
      // tabs quietly missed a new design's real pages.
      // html itself is not selected (it is the largest column and the list
      // never shows it), so a one-character stand-in says "the homepage
      // exists" — which it does for every archived design.
      available: availablePages({ html: "x", inner_html, pages, direction }),
      // A design archived before the full pack existed has a homepage and
      // nothing to build from.
      rebuildable: Boolean(parts.css),
      // The preview picture's cache-buster; 0 means no picture, load the old
      // iframe preview instead.
      thumb: typeof thumb?.version === "number" ? thumb.version : 0,
    };
  });

  return NextResponse.json({ success: true, designs: rows });
}
