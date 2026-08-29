import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * WordPress -> SaaS : poll a background job started by build-files-start.
 * Returns { status: "running" | "done" | "error", result?, error? }.
 * Scoped to the authenticated site's project.
 */

type Json = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  let body: Json = {};
  try {
    body = (await request.json()) as Json;
  } catch {
    body = {};
  }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";

  if (!jobId) {
    return NextResponse.json(
      { success: false, error: "A jobId is required." },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data: job, error } = await supabase
    .from("ai_jobs")
    .select("id, status, result, error")
    .eq("id", jobId)
    .eq("project_id", auth.context.projectId)
    .single();

  if (error || !job) {
    return NextResponse.json(
      { success: false, error: "Job not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    status: job.status,
    result: job.result ?? null,
    error: job.error ?? null,
  });
}
