import { NextRequest, NextResponse, after } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  generateArtDirection,
  generateMockup,
  generateInnerMockup,
  critiqueMockup,
  splitMockup,
  type MockupResult,
} from "@/lib/agent/mockup-core";
import { resolveShape } from "@/lib/agent/art-direction";
import { repairMockup, validateMockup, retryNote } from "@/lib/agent/validate-mockup";
import { logUsage } from "@/lib/ai/usage";

// The response returns immediately with a job id; the mockup itself renders in
// after() and can take a couple of minutes on a strong model.
export const maxDuration = 300;

/**
 * WordPress -> SaaS : START the homepage design job.
 *
 * Five stages, of which only one is expensive:
 *
 *   1  art direction   cheap model, decides everything
 *   2  the homepage    strong model, executes those decisions
 *   2b validation      pure code, free — did it actually execute them?
 *   2c one retry       only when a fatal check failed
 *   3  critique        cheap model, written for the person
 *   4  inner page      cheap model, constrained by the same tokens
 *
 * Stage 2b is the point of the redesign. Before it existed, "the model ignored
 * the direction" and "the model followed the direction" produced the same
 * 200 response, so nobody could tell them apart without looking at the page.
 */

type Json = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
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

  // Old plugin builds send designStyle; new ones send shape. Both resolve to
  // one of the four structural shapes.
  const shape = resolveShape(body.shape ?? body.designStyle);

  const language =
    typeof body.language === "string" ? body.language.trim().slice(0, 12) : "";

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

    const setProgress = async (stage: string, note: string) => {
      await db
        .from("ai_jobs")
        .update({
          result: { progress: { stage, note } },
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .then(
          () => {},
          () => {}
        );
    };

    try {
      // ---- Stage 1 (cheap model): the art direction ----
      // The progress stage stays named "concept" so plugin builds that predate
      // this pipeline still narrate it correctly.
      await setProgress("concept", "Stage 1/4 — choosing the art direction…");

      let direction = null;
      try {
        const d = await generateArtDirection(modelConfig, brief, shape, language);
        logUsage(projectId, "concept", d.model, d.usage, {
          shape,
          concept: d.data?.concept.name ?? null,
          parsed: Boolean(d.data),
        });
        direction = d.data;
      } catch (directionError) {
        console.error("art direction stage error (continuing without):", directionError);
      }

      // ---- Stage 2 (strong model): the homepage ----
      await setProgress(
        "design",
        direction
          ? `Stage 2/4 — "${direction.concept.name}" chosen, drawing the homepage…`
          : "Stage 2/4 — drawing the homepage…"
      );

      let mock = await generateMockup(modelConfig, brief, variation, shape, direction);
      logUsage(projectId, "design", mock.model, mock.usage, {
        shape,
        concept: direction?.concept.name ?? null,
        sections: mock.sections.map((sec) => sec.slug),
        chars: mock.html.length,
        truncated: mock.truncated,
      });

      // ---- Stage 2b: repair, then check what repair could not fix (free) ----
      mock = repaired(mock, direction);

      let check = validateMockup(mock.html, mock.css, mock.sections, direction);

      if (check.failures.length) {
        console.log(
          `mockup validation: ${check.failures
            .map((f) => `${f.fatal ? "FATAL" : "soft"} ${f.code}`)
            .join(", ")}`
        );
      }

      // ---- Stage 2c: one retry, naming only what broke ----
      let retried = false;

      if (!check.ok && !mock.truncated) {
        retried = true;
        await setProgress("design", "Stage 2/4 — tightening the design to the direction…");

        try {
          const second = await generateMockup(
            modelConfig,
            brief,
            variation,
            shape,
            direction,
            retryNote(check.failures)
          );

          logUsage(projectId, "design", second.model, second.usage, {
            shape,
            retry: true,
            fixing: check.failures.filter((f) => f.fatal).map((f) => f.code),
            chars: second.html.length,
            truncated: second.truncated,
          });

          const fixed = repaired(second, direction);
          const secondCheck = validateMockup(
            fixed.html,
            fixed.css,
            fixed.sections,
            direction
          );

          // Keep the retry only if it is genuinely better. A second attempt that
          // breaks more than the first is worse than the page we already had.
          if (!fixed.truncated && fatalCount(secondCheck) < fatalCount(check)) {
            mock = fixed;
            check = secondCheck;
          }
        } catch (retryError) {
          console.error("design retry error (keeping first attempt):", retryError);
        }
      }

      const ok = mock.sections.length >= 3 && mock.css.length > 200 && !mock.truncated;

      // ---- Stage 3 (cheap model): the review the person reads ----
      let critique = "";
      if (ok) {
        await setProgress("critique", "Stage 3/4 — quick design review…");
        try {
          const r = await critiqueMockup(modelConfig, mock.html, direction);
          logUsage(projectId, "critique", r.model, r.usage, { critique: r.data.slice(0, 300) });
          critique = r.data;
        } catch (critiqueError) {
          console.error("critique stage error (continuing without):", critiqueError);
        }
      }

      // ---- Stage 4 (cheap model): a representative inner page ----
      let inner: { html: string; css: string; pageHero: string } | null = null;
      if (ok) {
        await setProgress("inner", "Stage 4/4 — designing an inner page…");
        try {
          const inn = await generateInnerMockup(modelConfig, brief, direction, {
            css: mock.css,
            header: mock.header,
            footer: mock.footer,
            fonts: mock.fonts,
          });
          logUsage(projectId, "inner", inn.model, inn.usage, {
            chars: inn.html.length,
            heroFound: !!inn.pageHero,
            cssChars: inn.css.length,
            truncated: inn.truncated,
          });
          if (!inn.truncated && inn.pageHero && inn.html.length > 1000) {
            inner = { html: inn.html, css: inn.css, pageHero: inn.pageHero };
          }
        } catch (innerError) {
          console.error("inner-page stage error (continuing without):", innerError);
        }
      }

      // Archive the design so nothing is lost when ai_jobs is cleaned up.
      let designId: string | null = null;
      if (ok) {
        try {
          const { data: design } = await db
            .from("ai_designs")
            .insert({
              project_id: projectId,
              brief: {
                ...(typeof brief === "object" && brief ? brief : {}),
                shape,
                concept: direction?.concept.name ?? null,
                direction,
                validation: check.failures,
                retried,
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
                // Names kept from the previous pipeline: the wizard reads them.
                conceptName: direction?.concept.name ?? null,
                conceptIdea: direction?.concept.thesis ?? null,
                signatureMove: direction?.signatureMove ?? null,
                critique: critique || null,
                html: mock.html,
                css: mock.css,
                header: mock.header,
                footer: mock.footer,
                fonts: mock.fonts,
                sections: mock.sections,
                innerHtml: inner?.html ?? null,
                innerCss: inner?.css ?? null,
                pageHero: inner?.pageHero ?? null,
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

function fatalCount(result: { failures: { fatal: boolean }[] }): number {
  return result.failures.filter((f) => f.fatal).length;
}

/**
 * Apply the deterministic fixes, then re-split.
 *
 * The repair rewrites the :root block and can add <link> tags, so the derived
 * pieces — css, header, footer, fonts, sections — have to be cut from the
 * corrected document rather than the original one.
 */
function repaired(mock: MockupResult, direction: Parameters<typeof repairMockup>[1]): MockupResult {
  const { html, repairs } = repairMockup(mock.html, direction);

  if (!repairs.length) return mock;

  console.log(`mockup repaired: ${repairs.join("; ")}`);

  return { ...mock, html, ...splitMockup(html) };
}
