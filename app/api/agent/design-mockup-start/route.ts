import { NextRequest, NextResponse, after } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  generateArtDirection,
  generateMockup,
  generateInnerMockup,
  generateComponentSheet,
  generateExtraPage,
  critiqueMockup,
  splitMockup,
  type MockupResult,
} from "@/lib/agent/mockup-core";
import { renderBrandSheet } from "@/lib/agent/brand-sheet";
import { colorwayCss } from "@/lib/agent/design-pages";
import { resolveShape, type ArtDirection } from "@/lib/agent/art-direction";
import {
  repairMockup,
  validateMockup,
  retryNote,
  type ValidationResult,
} from "@/lib/agent/validate-mockup";
import { recordUsage } from "@/lib/ai/usage";
import { refundJobUsage } from "@/lib/billing/credits";
import { describeError } from "@/lib/debug";

// The response returns immediately with a job id; the mockup itself renders in
// after() and can take a couple of minutes on a strong model.
//
// 800 is the maximum generally available on Vercel Pro, and the design step
// genuinely needs it: one call that writes a whole homepage produces twenty-odd
// thousand tokens, which no strong model finishes inside five minutes. At 300
// the run was killed mid-call every time — no error, no artefact, just a job
// left running.
//
// Two other numbers must move with this one, or raising it makes things worse:
//   - DEAD_AFTER_MS in app/api/agent/job-status/route.ts, or a job that is
//     still working is declared dead, refunded, and then finishes anyway;
//   - the poll ceiling in the WordPress plugin, or the browser gives up while
//     the server is still working and the person sees a timeout regardless.
export const maxDuration = 800;

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

      // The call is given the time that actually remains, less enough to store
      // what comes back. Reaching the deadline throws, which fails the job and
      // refunds it — rather than the platform killing the process silently.
      let mock = await generateMockup(
        modelConfig,
        brief,
        variation,
        shape,
        direction,
        undefined,
        Math.max(60_000, msLeft() - 60_000)
      );

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
      let designId = await archive(db, projectId, jobId, shape, mock, direction, check, false);

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
            retryNote(check.failures),
            Math.max(60_000, msLeft() - 45_000)
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
            designId = await archive(db, projectId, jobId, shape, mock, direction, check, true, designId);
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

      // ---- The brand sheet: free, so it is never gated ----
      //
      // Every fact on it was decided by the art director already; rendering a
      // document from decisions already made needs no model at all.
      const pages: Record<string, string> = {};

      if (direction) {
        try {
          pages.brand = renderBrandSheet(direction, brandName(brief, direction));
          done.hasBrandSheet = true;
          // The CSS, not just the names: a colourway nobody can apply is a
          // label. One :root block is the whole re-skin.
          done.colorways = colorwayCss(direction);
        } catch (brandError) {
          console.error("brand sheet render failed:", brandError);
        }
      }

      const home = {
        css: mock.css,
        header: mock.header,
        footer: mock.footer,
        fonts: mock.fonts,
      };

      // ---- The component system, derived from the finished page ----
      //
      // First of the derived stages because everything after it reuses its
      // classes: an archive built without it invents its own card and pagination.
      let componentCss = "";

      if (msLeft() > 150_000) {
        await setProgress("components", "Building the component set…");
        try {
          const sheet = await generateComponentSheet(
            modelConfig,
            brief,
            direction,
            home,
            Math.max(45_000, msLeft() - 90_000)
          );

          await recordUsage(projectId, "inner", sheet.model, sheet.usage, {
            kind: "components",
            blocks: sheet.blocks.map((b) => b.slug),
            truncated: sheet.truncated,
          }, jobId);

          if (!sheet.truncated && sheet.blocks.length >= 4) {
            pages.components = sheet.html;
            componentCss = sheet.css;
            done.components = sheet.blocks;
            done.componentsCss = sheet.css;
          }
        } catch (sheetError) {
          console.error("component sheet error (continuing without):", sheetError);
        }
      }

      // ---- A representative inner page ----
      if (msLeft() > 130_000) {
        await setProgress("inner", "Designing an inner page…");
        try {
          const inn = await generateInnerMockup(
            modelConfig,
            brief,
            direction,
            home
          );

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
      }

      // ---- The archive, then the 404 ----
      //
      // Ordered by how much they are missed. A theme without an archive has no
      // blog; a theme without a designed 404 has a plain one.
      for (const kind of ["archive", "notfound"] as const) {
        const need = kind === "archive" ? 130_000 : 70_000;

        if (msLeft() < need) {
          console.log(`${kind} skipped: only ${Math.round(msLeft() / 1000)}s left`);
          continue;
        }

        await setProgress(
          kind,
          kind === "archive" ? "Designing the blog archive…" : "Designing the 404 page…"
        );

        try {
          const page = await generateExtraPage(
            modelConfig,
            brief,
            direction,
            home,
            kind,
            componentCss,
            Math.max(40_000, msLeft() - 50_000)
          );

          await recordUsage(projectId, "inner", page.model, page.usage, {
            kind,
            chars: page.html.length,
            bodyFound: Boolean(page.body),
            truncated: page.truncated,
          }, jobId);

          if (!page.truncated && page.body) {
            pages[kind] = page.html;
            (done as Record<string, unknown>)[`${kind}Css`] = page.css;
            (done as Record<string, unknown>)[`${kind}Body`] = page.body;
          }
        } catch (pageError) {
          console.error(`${kind} page error (continuing without):`, pageError);
        }
      }

      // ---- The review the person reads ----
      if (msLeft() > 40_000) {
        await setProgress("critique", "Quick design review…");
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

      await enrich(
        db,
        designId,
        pages,
        String(done.critique ?? ""),
        done.innerHtml
          ? {
              html: String(done.innerHtml),
              css: String(done.innerCss ?? ""),
              pageHero: String(done.pageHero ?? ""),
            }
          : null,
        {
          css: mock.css,
          header: mock.header,
          footer: mock.footer,
          fonts: mock.fonts,
          sections: mock.sections,
        }
      );

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

      // describeError, not error.message: Node's fetch reports every transport
      // failure as "fetch failed" and hides the reason in `cause`, which is
      // exactly the string that used to land in this column and explain nothing.
      await failJob(db, jobId, describeError(error).slice(0, 500));
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
  shape: string,
  mock: MockupResult,
  direction: ArtDirection | null,
  check: ValidationResult,
  retried: boolean,
  existingId?: string | null
): Promise<string | null> {
  const row = {
    project_id: projectId,
    job_id: jobId,
    shape,
    concept: direction?.concept.name ?? null,
    brief: {
      jobId,
      concept: direction?.concept.name ?? null,
    },
    model: mock.model,
    html: mock.html,

    // The pieces the splitter cut out. Storing them means a design can be
    // rebuilt, re-previewed or ported to PHP later without generating anything
    // again — previously they existed only in a job row that is swept away
    // after a day, so an archived design could never be used for anything but
    // looking at.
    assets: {
      css: mock.css,
      header: mock.header,
      footer: mock.footer,
      fonts: mock.fonts,
      sections: mock.sections,
    },

    direction,
    validation: check.failures,
    retried,
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

/**
 * Add what the later stages produced to a design already on disk.
 *
 * Called after the critique and the inner page, both of which are optional and
 * either of which may be skipped when the clock runs short. Failing here costs
 * the extras, never the homepage.
 */
async function enrich(
  db: Db,
  designId: string | null,
  pages: Record<string, string>,
  critique: string,
  inner: { html: string; css: string; pageHero: string } | null,
  assets: Record<string, unknown>
): Promise<void> {
  if (!designId) return;

  const patch: Record<string, unknown> = {};

  if (critique) patch.critique = critique;
  if (Object.keys(pages).length) patch.pages = pages;

  if (inner) {
    patch.inner_html = inner.html;
    patch.assets = { ...assets, innerCss: inner.css, pageHero: inner.pageHero };
  }

  if (!Object.keys(patch).length) return;

  const { error } = await db.from("ai_designs").update(patch).eq("id", designId);

  if (error) {
    console.error("design enrich failed:", error.message);
  }
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

/**
 * The name to letter the brand sheet with.
 *
 * The wizard's own field first — it is what the person typed — and the concept
 * name only when they left it blank.
 */
function brandName(brief: unknown, direction: ArtDirection): string {
  const row = (brief ?? {}) as Record<string, unknown>;
  const brand = (row.brand ?? {}) as Record<string, unknown>;

  const candidates = [row.name, brand.name, direction.concept.name];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 60);
    }
  }

  return "Brand";
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
