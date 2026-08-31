import { NextRequest, NextResponse } from "next/server";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";

/** WordPress -> SaaS : list the project's archived designs (metadata only). */

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request, { credits: false });

  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { data: designs, error } = await createServiceClient()
    .from("ai_designs")
    .select(
      "id, brief, model, status, concept, shape, retried, critique, inner_html, pages, assets, input_tokens, output_tokens, created_at"
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
    const { inner_html, pages, assets, ...rest } = row as Record<string, unknown>;
    const stored = (pages ?? {}) as Record<string, unknown>;
    const parts = (assets ?? {}) as Record<string, unknown>;

    const available = [
      "home",
      ...(inner_html ? ["inner"] : []),
      ...["components", "archive", "notfound", "brand"].filter(
        (key) => typeof stored[key] === "string" && (stored[key] as string).length > 0
      ),
    ];

    return {
      ...rest,
      hasInner: Boolean(inner_html),
      available,
      // A design archived before the full pack existed has a homepage and
      // nothing to build from.
      rebuildable: Boolean(parts.css),
    };
  });

  return NextResponse.json({ success: true, designs: rows });
}
