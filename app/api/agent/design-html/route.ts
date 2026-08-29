import { NextRequest, NextResponse } from "next/server";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";

/** WordPress -> SaaS : one archived design's HTML for the wp-admin preview. */

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

  if (!designId) {
    return NextResponse.json(
      { success: false, error: "A designId is required." },
      { status: 400 }
    );
  }

  const { data: design, error } = await createServiceClient()
    .from("ai_designs")
    .select("id, html")
    .eq("id", designId)
    .eq("project_id", auth.context.projectId)
    .single();

  if (error || !design) {
    return NextResponse.json({ success: false, error: "Design not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, html: design.html });
}
