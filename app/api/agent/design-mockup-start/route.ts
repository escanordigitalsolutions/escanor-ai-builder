import { NextRequest, NextResponse, after } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { generateMockup, generateConcept, critiqueMockup, resolveStyle } from "@/lib/agent/mockup-core";
import { logUsage } from "@/lib/ai/usage";

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
  const style = resolveStyle(body.designStyle);

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

    // Live progress: while the job is running, result carries {progress} so
    // the wizard can narrate each stage to the user.
    const setProgress = async (stage: string, note: string) => {
      await db
        .from("ai_jobs")
        .update({
          result: { progress: { stage, note } },
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .then(() => {}, () => {});
    };

    try {
      // ---- Stage 1/3 (cheap model): creative concept ----
      await setProgress("concept", "Stage 1/3 — inventing the creative concept…");
      let concept = null;
      try {
        const c = await generateConcept(modelConfig, brief, style);
        await logUsage(projectId, "concept", c.model, c.usage, { style, concept: c.data?.concept ?? null });
        concept = c.data;
      } catch (conceptError) {
        console.error("concept stage error (continuing without):", conceptError);
      }

      // ---- Stage 2/3 (strong model): the homepage itself ----
      await setProgress(
        "design",
        concept?.concept
          ? `Stage 2/3 — concept "${concept.concept}" chosen, drawing the homepage…`
          : "Stage 2/3 — drawing the homepage…"
      );
      const mock = await generateMockup(modelConfig, brief, variation, style, concept);
      await logUsage(projectId, "design", mock.model, mock.usage, {
        style,
        concept: concept?.concept ?? null,
        sections: mock.sections.map((sec) => sec.slug),
        chars: mock.html.length,
        truncated: mock.truncated,
      });
      const ok = mock.sections.length >= 3 && mock.css.length > 200 && !mock.truncated;

      // ---- Stage 3/3 (cheap model): short review for the user ----
      let critique = "";
      if (ok) {
        await setProgress("critique", "Stage 3/3 — quick design review…");
        try {
          const r = await critiqueMockup(modelConfig, mock.html);
          await logUsage(projectId, "critique", r.model, r.usage, { critique: r.data.slice(0, 300) });
          critique = r.data;
        } catch (critiqueError) {
          console.error("critique stage error (continuing without):", critiqueError);
        }
      }

      // Archive the design (every attempt, accepted or not) so nothing is lost
      // when ai_jobs is cleaned up. Best-effort — a failed insert never blocks.
      let designId: string | null = null;
      if (ok) {
        try {
          const { data: design } = await db
            .from("ai_designs")
            .insert({
              project_id: projectId,
              brief: {
                ...(typeof brief === "object" && brief ? brief : {}),
                style,
                concept: concept?.concept ?? null,
              },
              model: mock.model,
              html: mock.html,
              status: "pending",
              input_tokens: mock.usage.inputTokens,
              output_tokens: mock.usage.outputTokens,
            })
            .select("id")
            .single();
          designId = (design?.id as string) ?? null;
        } catch (archiveError) {
          console.error("design archive error:", archiveError);
        }
      }

      await db
        .from("ai_jobs")
        .update({
          status: ok ? "done" : "error",
          result: ok
            ? {
                success: true,
                designId,
                conceptName: concept?.concept ?? null,
                conceptIdea: concept?.idea ?? null,
                critique: critique || null,
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
