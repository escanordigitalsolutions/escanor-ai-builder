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
      "id, brief, model, status, concept, shape, retried, critique, inner_html, input_tokens, output_tokens, created_at"
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
  const rows = (designs ?? []).map((row) => {
    const { inner_html, ...rest } = row as Record<string, unknown>;
    return { ...rest, hasInner: Boolean(inner_html) };
  });

  return NextResponse.json({ success: true, designs: rows });
}
