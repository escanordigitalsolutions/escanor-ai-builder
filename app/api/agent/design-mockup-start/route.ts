import { NextRequest, NextResponse, after } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  generateArtDirection,
  generateMockup,
  generateSitePage,
  sitePageSpecs,
  critiqueMockup,
  splitMockup,
  type MockupResult,
  type SitePageResult,
} from "@/lib/agent/mockup-core";
import {
  detectContainer,
  pageRetryNote,
  validateSitePage,
  type PageFailure,
} from "@/lib/agent/page-shell";
import { availablePages, colorwayCss } from "@/lib/agent/design-pages";
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
import { inParallel } from "@/lib/parallel";

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
 * How many pages are designed at the same time.
 *
 * Three rather than all of them: the pages are independent, but the provider is
 * not, and eight simultaneous long streams is where a rate limit turns a whole
 * successful generation into a failed one. Three finishes a site of eight pages
 * in three waves, which fits the budget with room to spare, and a wave that
 * fails takes one page with it rather than the set.
 */
const PAGE_CONCURRENCY = 3;


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
      let designId = await archive(db, projectId, jobId, shape, brief, mock, direction, check, false);

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
            designId = await archive(db, projectId, jobId, shape, brief, mock, direction, check, true, designId);
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

      // ---- Every other page of the site, all at once ----
      //
      // These used to run one after another — components, then an inner-page
      // template, then the archive, then the 404 — and each was gated on having
      // two minutes left, so a slow homepage silently cost the site its blog.
      // The order was never necessary: every one of them needs the direction
      // and the finished homepage, and none of them needs another. Running them
      // together is what makes a site of eight real pages cost about what one
      // template used to.
      const pages: Record<string, string> = {};

      if (direction) {
        // The CSS, not just the names: a colourway nobody can apply is a
        // label. One :root block is the whole re-skin.
        done.colorways = colorwayCss(direction);
      }

      const home = {
        css: mock.css,
        header: mock.header,
        footer: mock.footer,
        fonts: mock.fonts,
      };

      const specs = sitePageSpecs(direction);

      // The wrapper the homepage holds its content in. Every derived page has
      // to use it, and until this was passed down four pages out of seven put
      // their content on a different left edge from the homepage — one of them
      // against the window.
      const container = detectContainer(mock.html, mock.css);

      if (specs.length && msLeft() > 90_000) {
        await setProgress(
          "pages",
          `Stage 3/4 — designing ${specs.length} more page${specs.length === 1 ? "" : "s"}…`
        );

        // Enough room for the slowest page plus the writes that follow it. Each
        // call gets the same deadline because they are running together.
        const pageTimeout = Math.max(45_000, msLeft() - 45_000);
        let finished = 0;

        const draw = async (spec: (typeof specs)[number], retry?: string) => {
          const page = await generateSitePage(
            modelConfig,
            brief,
            direction,
            home,
            spec,
            pageTimeout,
            { container, retry }
          );

          await recordUsage(projectId, "inner", page.model, page.usage, {
            kind: spec.slug,
            chars: page.html.length,
            bodyFound: Boolean(page.body),
            heroFound: Boolean(page.pageHero),
            truncated: page.truncated,
            retry: Boolean(retry),
          }, jobId);

          return page;
        };

        // A truncated page is half a page, and a page that fails the shell
        // checks is one that walks differently from the rest of the site.
        // Both are worth one more attempt each, which is cheap here.
        const judge = (page: SitePageResult, spec: (typeof specs)[number]) =>
          page.truncated || !page.body
            ? [{ code: "page.truncated", detail: "The page did not finish.", fatal: true }]
            : validateSitePage(
                { slug: spec.slug, body: page.body, css: page.css },
                { container, minWords: spec.minWords }
              );

        type Drawn = { spec: (typeof specs)[number]; page: SitePageResult | null; failures: PageFailure[] };

        const first: Drawn[] = await inParallel(specs, PAGE_CONCURRENCY, async (spec) => {
          try {
            const page = await draw(spec);
            const failures = judge(page, spec);

            finished += 1;
            void setProgress("pages", `Stage 3/4 — ${finished} of ${specs.length} pages designed…`);

            return { spec, page, failures };
          } catch (pageError) {
            console.error(`page ${spec.slug} failed (continuing without):`, pageError);
            return { spec, page: null, failures: [] };
          }
        });

        const fatal = (rows: PageFailure[]) => rows.filter((f) => f.fatal).length;
        const needsWork = first.filter((row) => row.page && fatal(row.failures) > 0);

        if (needsWork.length && msLeft() > 80_000) {
          console.log(
            `redrawing ${needsWork.length} page(s): ` +
              needsWork.map((r) => `${r.spec.slug}[${r.failures.filter((f) => f.fatal).map((f) => f.code).join(",")}]`).join(" ")
          );
          await setProgress(
            "pages",
            `Stage 3/4 — redrawing ${needsWork.length} page${needsWork.length === 1 ? "" : "s"} that drifted…`
          );

          await inParallel(needsWork, PAGE_CONCURRENCY, async (row) => {
            try {
              const page = await draw(row.spec, pageRetryNote(row.failures, container));
              const failures = judge(page, row.spec);

              // Keep the retry only when it is genuinely better. A second
              // attempt that breaks more than the first is worse than the page
              // already in hand.
              if (fatal(failures) < fatal(row.failures)) {
                row.page = page;
                row.failures = failures;
              }
            } catch (retryError) {
              console.error(`page ${row.spec.slug} retry failed (keeping first):`, retryError);
            }
            return null;
          });
        }

        // A page that still fails every check after a second attempt is kept
        // anyway: a site missing its Services page is worse than one whose
        // Services page sits slightly wide, and the log says which it was.
        const results = first.map((row) => row.page);

        for (const row of first) {
          if (row.page && fatal(row.failures)) {
            console.log(
              `page ${row.spec.slug} shipped with ${fatal(row.failures)} fault(s): ` +
                row.failures.filter((f) => f.fatal).map((f) => f.code).join(", ")
            );
          }
        }

        done.pageFaults = first
          .filter((row) => row.page && fatal(row.failures))
          .map((row) => ({
            slug: row.spec.slug,
            title: row.spec.title,
            codes: row.failures.filter((f) => f.fatal).map((f) => f.code),
          }));

        for (const page of results) {
          if (!page) continue;

          pages[page.slug] = page.html;

          // The build reads these two by name for the archive and the 404.
          if (page.slug === "archive" || page.slug === "notfound") {
            (done as Record<string, unknown>)[`${page.slug}Css`] = page.css;
            (done as Record<string, unknown>)[`${page.slug}Body`] = page.body;
          }
        }

        // Every content template in the theme — page.php, page-<slug>.php,
        // single.php — is built around one page hero and one set of .entry
        // rules. The blog post is where both are demonstrated in full, so it is
        // the page they come from; any other designed page will do if the post
        // did not survive, since they all carry the same hero.
        const forTemplate =
          results.find((p) => p && p.slug === "post" && p.pageHero) ??
          results.find((p) => p && p.pageHero) ??
          null;

        if (forTemplate) {
          done.innerHtml = forTemplate.html;
          done.innerCss = forTemplate.css;
          done.pageHero = forTemplate.pageHero;
        }

        // Each page's stylesheet holds only the rules that page adds on top of
        // the homepage, so the rules every content page needs — forms, entry
        // typography, whatever a page invented — are all of them together. This
        // is what the component sheet used to supply, now cut from real pages
        // instead of from a catalogue. The archive and the 404 are left out:
        // they have their own stylesheet in the theme.
        done.pagesCss = results
          .filter((p): p is NonNullable<typeof p> =>
            Boolean(p?.css) && p!.slug !== "archive" && p!.slug !== "notfound")
          .map((p) => `/* ${p.slug} */\n${p.css}`)
          .join("\n\n");
      } else if (specs.length) {
        console.log(`derived pages skipped: only ${Math.round(msLeft() / 1000)}s left`);
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

      // What the preview rail is built from. Derived here because only the
      // server knows which pages actually survived: any of them may fail or be
      // dropped for truncation, and a rail entry for a page that does not exist
      // is worse than no entry. It carries labels, not just slugs — the rail
      // says "Use cases", not "use-cases".
      done.pages = availablePages({
        html: mock.html,
        inner_html: done.innerHtml ?? null,
        pages,
        direction,
      });

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
          // Every designed page's extra rules, together. A rebuild from the
          // archive needs them: without it the theme's page stylesheet would
          // have to be re-derived from six documents.
          pagesCss: String(done.pagesCss ?? ""),
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
  input: unknown,
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
    // The whole point of this archive is comparing runs, and until now the one
    // thing it did not keep was what was asked for. Two designs a week apart
    // were indistinguishable in the record even when the prompt had changed.
    brief: {
      jobId,
      concept: direction?.concept.name ?? null,
      input,
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
    // The site's own pages, decided by the art director. Named sitePages
    // because `pages` on this payload already means the preview's screen tabs.
    // The build inherits this list instead of inventing a second one, so the
    // nav a visitor sees in the preview is the nav the theme ships with.
    sitePages: direction?.pages ?? [],
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
