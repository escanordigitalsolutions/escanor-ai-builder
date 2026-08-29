import { NextRequest, NextResponse, after } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { generateMockup } from "@/lib/agent/mockup-core";

// The response returns immediately with a job id; the mockup itself renders in
// after() and can take a couple of minutes on a strong model.
export const maxDuration = 300;

/**
 * WordPress -> SaaS : START the homepage-mockup design job (design-first
 * pipeline, step 1). Same async pattern as build-files-start: a job row is
 * created, generation runs in after(), the wizard polls agent/job-status.
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

  const brief = body.brief ?? {};
  const variation =
    typeof body.variation === "string" ? body.variation.trim().slice(0, 500) : "";

  const projectId = auth.context.projectId;
  const supabase = createServiceClient();

  let modelConfig: unknown = {};
  try {
    const { data } = await supabase
      .from("projects")
      .select("model_config")
      .eq("id", projectId)
      .single();
    modelConfig = data?.model_config ?? {};
  } catch {
    modelConfig = {};
  }

  const { data: job, error: jobError } = await supabase
    .from("ai_jobs")
    .insert({ project_id: projectId, kind: "mockup", status: "running" })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("design-mockup-start job insert error:", jobError);
    const missingTable =
      typeof jobError?.message === "string" && /ai_jobs/i.test(jobError.message);
    return NextResponse.json(
      {
        success: false,
        error: missingTable
          ? "The ai_jobs table is missing in Supabase. Run the setup SQL, then retry."
          : "Could not start the design job.",
      },
      { status: 500 }
    );
  }

  const jobId = job.id as string;

  after(async () => {
    const db = createServiceClient();
    try {
      const mock = await generateMockup(modelConfig, brief, variation);
      const ok = mock.sections.length >= 3 && mock.css.length > 200 && !mock.truncated;
      await db
        .from("ai_jobs")
        .update({
          status: ok ? "done" : "error",
          result: ok
            ? {
                success: true,
                html: mock.html,
                css: mock.css,
                header: mock.header,
                footer: mock.footer,
                fonts: mock.fonts,
                sections: mock.sections,
                usage: mock.usage,
                model: mock.model,
              }
            : null,
          error: ok
            ? null
            : mock.truncated
              ? "The design ran too long and was cut off. Try again."
              : "The design did not come back in the expected structure. Try again.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    } catch (error) {
      console.error("design-mockup job error:", error);
      await db
        .from("ai_jobs")
        .update({
          status: "error",
          error:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "The designer could not be reached.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .then(
          () => {},
          () => {}
        );
    }
  });

  return NextResponse.json({ success: true, jobId });
}
