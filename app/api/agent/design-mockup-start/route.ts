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
import { resolveShape, type ArtDirection } from "@/lib/agent/art-direction";
import {
  repairMockup,
  validateMockup,
  retryNote,
  type ValidationResult,
} from "@/lib/agent/validate-mockup";
import { recordUsage } from "@/lib/ai/usage";
import { refundJobUsage } from "@/lib/billing/credits";

// The response returns immediately with a job id; the mockup itself renders in
// after() and can take a couple of minutes on a strong model.
//
// Raising this is the one lever that buys the pipeline more room: on Vercel Pro
// with Fluid Compute it can go to 800. Every stage below budgets itself against
// this number — and DEAD_AFTER_MS in app/api/agent/job-status/route.ts MUST be
// raised with it, or a job that is still working will be declared dead,
// refunded, and then finish anyway.
export const maxDuration = 300;

const BUDGET_MS = maxDuration * 1000;

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
  // maxDuration is counted from here, not from where after() begins: the auth
  // lookup, the project read and the job insert all spend budget the stage
  // gates below must not pretend they still have.
  const requestStart = Date.now();

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
    const startedAt = requestStart;

    /**
     * What is left of the function's life.
     *
     * maxDuration covers the after() callback too, so when it runs out the
     * process is killed mid-sentence — no catch block runs, no row is written.
     * Every expensive step below therefore asks whether it still fits before
     * starting, because a stage that cannot finish is worse than one never
     * begun: it costs the money and delivers nothing.
     */
    const msLeft = () => BUDGET_MS - (Date.now() - startedAt);

    // The finished homepage, held here so progress updates never overwrite it
    // and so a stalled job can still be recovered from the row.
    let ready: Record<string, unknown> | null = null;

    const setProgress = async (stage: string, note: string) => {
      await db
        .from("ai_jobs")
        .update({
          result: { ...(ready ?? {}), progress: { stage, note } },
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
        await recordUsage(projectId, "concept", d.model, d.usage, {
          shape,
          concept: d.data?.concept.name ?? null,
          parsed: Boolean(d.data),
        }, jobId);
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

      const designStart = Date.now();
      let mock = await generateMockup(modelConfig, brief, variation, shape, direction);
      const designMs = Date.now() - designStart;

      await recordUsage(projectId, "design", mock.model, mock.usage, {
        shape,
        concept: direction?.concept.name ?? null,
        sections: mock.sections.map((sec) => sec.slug),
        chars: mock.html.length,
        ms: designMs,
        truncated: mock.truncated,
      }, jobId);

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

      const ok = mock.sections.length >= 3 && mock.css.length > 200 && !mock.truncated;

      if (!ok) {
        await failJob(
          db,
          jobId,
          mock.truncated
            ? "The design ran too long and was cut off. Try again."
            : "The design did not come back in the expected structure. Try again."
        );
        return;
      }

      // ---- Persist the homepage NOW, before anything else can go wrong ----
      //
      // This used to happen at the very end, after the critique, the inner page
      // and a possible retry. A run killed on any of those threw away a
      // finished, already-paid-for homepage — which is exactly what happened in
      // production. Everything after this point improves something that is
      // already safe on disk.
      let designId = await archive(db, projectId, jobId, mock, direction, check, false);

      let done = payload(designId, mock, direction);
      ready = done;
      await writeResult(db, jobId, done);

      // ---- Stage 2c: one retry, if the clock genuinely allows it ----
      //
      // A retry is a second full generation: the same cost again, and roughly
      // the same time. The margin is deliberately generous because the model
      // call has no deadline of its own — nothing can interrupt it once it has
      // started, so a retry that overruns kills the whole process. It can no
      // longer destroy the run's output, because the first homepage is already
      // stored above, but it can still waste the money.
      const retryFits = msLeft() > designMs * 1.5 + 45_000;

      if (!check.ok && retryFits) {
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

          await recordUsage(projectId, "design", second.model, second.usage, {
            shape,
            retry: true,
            fixing: check.failures.filter((f) => f.fatal).map((f) => f.code),
            chars: second.html.length,
            truncated: second.truncated,
          }, jobId);

          const fixed = repaired(second, direction);
          const secondCheck = validateMockup(fixed.html, fixed.css, fixed.sections, direction);

          // Keep the retry only if it is genuinely better. A second attempt that
          // breaks more than the first is worse than the page already in hand.
          const better =
            !fixed.truncated &&
            fixed.sections.length >= 3 &&
            fixed.css.length > 200 &&
            fatalCount(secondCheck) < fatalCount(check);

          if (better) {
            mock = fixed;
            check = secondCheck;
            designId = await archive(db, projectId, jobId, mock, direction, check, true, designId);
            done = payload(designId, mock, direction);
            ready = done;
            await writeResult(db, jobId, done);
          }
        } catch (retryError) {
          console.error("design retry error (keeping first attempt):", retryError);
        }
      } else if (!check.ok) {
        console.log(
          `design retry skipped: ${Math.round(msLeft() / 1000)}s left, ` +
            `the first attempt took ${Math.round(designMs / 1000)}s`
        );
      }

      // ---- Stage 3 (cheap model): the review the person reads ----
      if (msLeft() > 40_000) {
        await setProgress("critique", "Stage 3/4 — quick design review…");
        try {
          const r = await critiqueMockup(modelConfig, mock.html, direction);
          await recordUsage(projectId, "critique", r.model, r.usage, {
            critique: r.data.slice(0, 300),
          }, jobId);
          done.critique = r.data || null;
        } catch (critiqueError) {
          console.error("critique stage error (continuing without):", critiqueError);
        }
      }

      // ---- Stage 4 (cheap model): a representative inner page ----
      // The most expendable stage, so it is the first to be dropped: without it
      // the build falls back to deriving inner pages from the homepage.
      if (msLeft() > 110_000) {
        await setProgress("inner", "Stage 4/4 — designing an inner page…");
        try {
          const inn = await generateInnerMockup(modelConfig, brief, direction, {
            css: mock.css,
            header: mock.header,
            footer: mock.footer,
            fonts: mock.fonts,
          });
          await recordUsage(projectId, "inner", inn.model, inn.usage, {
            chars: inn.html.length,
            heroFound: !!inn.pageHero,
            cssChars: inn.css.length,
            truncated: inn.truncated,
          }, jobId);

          if (!inn.truncated && inn.pageHero && inn.html.length > 1000) {
            done.innerHtml = inn.html;
            done.innerCss = inn.css;
            done.pageHero = inn.pageHero;
          }
        } catch (innerError) {
          console.error("inner-page stage error (continuing without):", innerError);
        }
      } else {
        console.log(`inner page skipped: only ${Math.round(msLeft() / 1000)}s left`);
      }

      await db
        .from("ai_jobs")
        .update({
          status: "done",
          result: done,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    } catch (error) {
      console.error("design-mockup job error:", error);

      // A homepage that survived is still worth delivering, even though the
      // rest of the run fell over.
      if (ready) {
        await db
          .from("ai_jobs")
          .update({ status: "done", result: ready, updated_at: new Date().toISOString() })
          .eq("id", jobId)
          .then(
            () => {},
            () => {}
          );
        return;
      }

      await failJob(
        db,
        jobId,
        error instanceof Error
          ? error.message.slice(0, 500)
          : "The designer could not be reached."
      );
    }
  });

  return NextResponse.json({ success: true, jobId });
}

type Db = ReturnType<typeof createServiceClient>;

/**
 * Store the generated homepage, and say so out loud when that fails.
 *
 * supabase-js returns errors rather than throwing them, so the try/catch that
 * used to wrap this insert could never fire: a failed archive left designId
 * null and the run carried on believing the page was safe. The jobId goes into
 * the brief so that a later failure can tell "produced nothing" apart from
 * "produced something and then died", which decides whether a refund is owed.
 */
async function archive(
  db: Db,
  projectId: string,
  jobId: string,
  mock: MockupResult,
  direction: ArtDirection | null,
  check: ValidationResult,
  retried: boolean,
  existingId?: string | null
): Promise<string | null> {
  const row = {
    project_id: projectId,
    brief: {
      jobId,
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
  };

  // A winning retry replaces the attempt it beat rather than leaving two rows
  // in the person's design archive.
  if (existingId) {
    const { error } = await db.from("ai_designs").update(row).eq("id", existingId);

    if (error) {
      console.error("design archive update failed:", error.message);
    }

    return existingId;
  }

  const { data, error } = await db.from("ai_designs").insert(row).select("id").single();

  if (error) {
    console.error("design archive insert failed:", error.message);
    return null;
  }

  return (data?.id as string) ?? null;
}

/** The result shape the wizard reads. Names are kept from the old pipeline. */
function payload(
  designId: string | null,
  mock: MockupResult,
  direction: ArtDirection | null
): Record<string, unknown> {
  return {
    success: true,
    designId,
    conceptName: direction?.concept.name ?? null,
    conceptIdea: direction?.concept.thesis ?? null,
    signatureMove: direction?.signatureMove ?? null,
    critique: null,
    html: mock.html,
    css: mock.css,
    header: mock.header,
    footer: mock.footer,
    fonts: mock.fonts,
    sections: mock.sections,
    innerHtml: null,
    innerCss: null,
    pageHero: null,
    usage: mock.usage,
    model: mock.model,
  };
}

/**
 * Write the finished homepage into the job row while it is still running.
 *
 * This is the row job-status reads when a killed run has to be recovered, so a
 * silent failure here would mean a delivered page reported as a failure — and
 * refunded. One retry, then a loud log.
 */
async function writeResult(
  db: Db,
  jobId: string,
  result: Record<string, unknown>
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await db
      .from("ai_jobs")
      .update({ result, updated_at: new Date().toISOString() })
      .eq("id", jobId);

    if (!error) return;

    console.error(`ai_jobs result write failed (attempt ${attempt + 1}):`, error.message);
  }
}

/**
 * End a job in failure and give the credits back.
 *
 * Usage is debited stage by stage, as each model call returns, because that is
 * when the money is really spent. When the run then produces nothing usable,
 * keeping those credits is charging for nothing — so the refund is part of
 * failing, not a separate act of goodwill.
 */
async function failJob(
  db: ReturnType<typeof createServiceClient>,
  jobId: string,
  message: string
): Promise<void> {
  await db
    .from("ai_jobs")
    .update({ status: "error", error: message, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .then(
      () => {},
      () => {}
    );

  try {
    await refundJobUsage(jobId, "Refund: design generation failed");
  } catch (refundError) {
    console.error("refund after failed design job:", refundError);
  }
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
