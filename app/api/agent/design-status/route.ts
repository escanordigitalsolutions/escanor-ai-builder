import { NextRequest, NextResponse } from "next/server";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * WordPress -> SaaS : mark an archived design as used or rejected when the
 * user decides in the wizard. Fire-and-forget from the plugin side.
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
  const status = body.status === "used" || body.status === "rejected" ? body.status : "";

  if (!designId || !status) {
    return NextResponse.json(
      { success: false, error: "designId and a valid status are required." },
      { status: 400 }
    );
  }

  const { error } = await createServiceClient()
    .from("ai_designs")
    .update({ status })
    .eq("id", designId)
    .eq("project_id", auth.context.projectId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
