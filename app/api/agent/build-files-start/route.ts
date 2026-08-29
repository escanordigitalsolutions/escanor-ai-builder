import { NextRequest, NextResponse, after } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { generateBuildFiles } from "@/lib/agent/build-files-core";

// The response returns immediately with a job id, but the generation itself
// runs in after() — it needs the full duration budget.
export const maxDuration = 300;

/**
 * WordPress -> SaaS : START a build-files batch as a background job.
 *
 * Long model calls (a solo main.css on Claude can take 1-2+ minutes) die
 * somewhere in the browser -> WordPress -> Vercel chain when any hop enforces
 * a short proxy/function timeout. This route removes the problem structurally:
 * it stores a job row, kicks the generation off in after() (so the function
 * keeps running once the response is sent), and returns a jobId at once. The
 * wizard polls job-status every few seconds — every request in the chain now
 * finishes in seconds, whatever the hosting.
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

  const blueprint = body.blueprint;
  const rawPaths = Array.isArray(body.paths) ? (body.paths as unknown[]) : [];
  const paths = rawPaths
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .slice(0, 12);

  if (!blueprint || typeof blueprint !== "object") {
    return NextResponse.json(
      { success: false, error: "A blueprint is required." },
      { status: 400 }
    );
  }
  if (paths.length === 0) {
    return NextResponse.json(
      { success: false, error: "At least one path is required." },
      { status: 400 }
    );
  }

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
    .insert({ project_id: projectId, kind: "build-files", status: "running" })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("build-files-start job insert error:", jobError);
    const missingTable =
      typeof jobError?.message === "string" && /ai_jobs/i.test(jobError.message);
    return NextResponse.json(
      {
        success: false,
        error: missingTable
          ? "The ai_jobs table is missing in Supabase. Run the setup SQL (create table public.ai_jobs …), then retry."
          : "Could not start the generation job.",
      },
      { status: 500 }
    );
  }

  const jobId = job.id as string;

  // Opportunistic cleanup so the table never grows unbounded.
  supabase
    .from("ai_jobs")
    .delete()
    .lt("created_at", new Date(Date.now() - 86400000).toISOString())
    .then(() => {});

  after(async () => {
    const db = createServiceClient();
    try {
      const result = await generateBuildFiles(modelConfig, blueprint, paths);
      const ok = result.files.length > 0;
      await db
        .from("ai_jobs")
        .update({
          status: ok ? "done" : "error",
          result: ok
            ? {
                success: true,
                files: result.files,
                truncated: result.truncated,
                usage: result.usage,
              }
            : null,
          error: ok
            ? null
            : result.truncated
              ? "This batch was too large to finish in one pass."
              : "The generator returned no files for this batch.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    } catch (error) {
      console.error("build-files job error:", error);
      await db
        .from("ai_jobs")
        .update({
          status: "error",
          error:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "The file generator could not be reached.",
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
