import { NextRequest, NextResponse, after } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { generateSitePage, sitePageSpecs, type SitePageResult } from "@/lib/agent/mockup-core";
import {
  detectContainer,
  pageRetryNote,
  validateSitePage,
  type PageFailure,
} from "@/lib/agent/page-shell";
import { availablePages } from "@/lib/agent/design-pages";
import { parseArtDirection, type ArtDirection } from "@/lib/agent/art-direction";
import { recordUsage } from "@/lib/ai/usage";
import { describeError } from "@/lib/debug";
import { inParallel } from "@/lib/parallel";

/**
 * WordPress -> SaaS : draw the rest of the site, once the homepage is approved.
 *
 * This used to happen inside the homepage job, and that was the wrong shape for
 * the person using it. They waited about four minutes for eight pages before
 * finding out whether the homepage was even the right direction, and paid for
 * all eight if it was not. And because the pages were already drawn, editing
 * the homepage afterwards left them behind — every page a copy of the version
 * being replaced.
 *
 * Splitting it fixes all three: the homepage arrives in about a minute, nothing
 * else is spent until somebody has looked at it, and an edit lands before the
 * pages exist so they are drawn from the design that was actually approved.
 */

export const maxDuration = 800;

const BUDGET_MS = maxDuration * 1000;

/**
 * How many pages are drawn at the same time.
 *
 * Three rather than all of them: the pages are independent, but the provider is
 * not, and eight simultaneous long streams is where a rate limit turns a run
 * that had already succeeded into a failure.
 */
const PAGE_CONCURRENCY = 3;

type Db = ReturnType<typeof createServiceClient>;

export async function POST(request: NextRequest) {
  const requestStart = Date.now();
  const auth = await authenticateSiteRequest(request, { credits: true });

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

  const projectId = auth.context.projectId;
  const supabase = createServiceClient();

  const { data: design, error: designError } = await supabase
    .from("ai_designs")
    .select("id, html, assets, direction, brief")
    .eq("id", designId)
    .eq("project_id", projectId)
    .single();

  if (designError || !design) {
    return NextResponse.json({ success: false, error: "Design not found." }, { status: 404 });
  }

  const assets = (design.assets ?? {}) as Record<string, unknown>;

  if (!design.html || !assets.css) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This design has no homepage stored, so the rest of the site cannot be drawn from it. Generate a new design.",
      },
      { status: 409 }
    );
  }

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
    .insert({ project_id: projectId, kind: "pages", status: "running" })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("design-pages-start job insert error:", jobError);
    return NextResponse.json(
      { success: false, error: "Could not start the page job." },
      { status: 500 }
    );
  }

  const jobId = job.id as string;

  after(async () => {
    const db = createServiceClient();
    const msLeft = () => BUDGET_MS - (Date.now() - requestStart);

    const done: Record<string, unknown> = { success: true, designId };

    const setProgress = async (note: string) => {
      await db
        .from("ai_jobs")
        .update({ result: { progress: { stage: "pages", note } }, updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .then(
          () => {},
          () => {}
        );
    };

    try {
      // The direction is stored parsed, but it is a year of runs' worth of
      // shapes in one column — so it goes back through the parser rather than
      // being trusted, and an unreadable one simply means no page list.
      const direction: ArtDirection | null =
        design.direction && typeof design.direction === "object"
          ? parseArtDirection(JSON.stringify(design.direction))
          : null;

      const home = {
        css: String(assets.css ?? ""),
        header: String(assets.header ?? ""),
        footer: String(assets.footer ?? ""),
        fonts: Array.isArray(assets.fonts) ? (assets.fonts as string[]) : [],
      };

      const specs = sitePageSpecs(direction);
      const container = detectContainer(String(design.html), home.css);

      if (!specs.length) {
        done.pages = availablePages({ html: design.html, pages: {}, direction });
        await finish(db, jobId, done);
        return;
      }

      await setProgress(`Designing ${specs.length} pages…`);

      const pageTimeout = Math.max(45_000, msLeft() - 45_000);
      let finished = 0;

      const draw = async (spec: (typeof specs)[number], retry?: string) => {
        const page = await generateSitePage(
          modelConfig,
          design.brief ?? {},
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

      const judge = (page: SitePageResult, spec: (typeof specs)[number]): PageFailure[] =>
        page.truncated || !page.body
          ? [{ code: "page.truncated", detail: "The page did not finish.", fatal: true }]
          : validateSitePage(
              { slug: spec.slug, body: page.body, css: page.css },
              { container, minWords: spec.minWords }
            );

      type Drawn = {
        spec: (typeof specs)[number];
        page: SitePageResult | null;
        failures: PageFailure[];
      };

      const drawn: Drawn[] = await inParallel(specs, PAGE_CONCURRENCY, async (spec) => {
        try {
          const page = await draw(spec);
          const failures = judge(page, spec);

          finished += 1;
          void setProgress(`${finished} of ${specs.length} pages designed…`);

          return { spec, page, failures };
        } catch (pageError) {
          console.error(`page ${spec.slug} failed (continuing without):`, pageError);
          return { spec, page: null, failures: [] };
        }
      });

      const fatal = (rows: PageFailure[]) => rows.filter((f) => f.fatal).length;
      const needsWork = drawn.filter((row) => row.page && fatal(row.failures) > 0);

      if (needsWork.length && msLeft() > 80_000) {
        await setProgress(
          `Redrawing ${needsWork.length} page${needsWork.length === 1 ? "" : "s"} that drifted…`
        );

        await inParallel(needsWork, PAGE_CONCURRENCY, async (row) => {
          try {
            const page = await draw(row.spec, pageRetryNote(row.failures, container));
            const failures = judge(page, row.spec);

            // Keep the retry only when it is genuinely better. A second attempt
            // that breaks more than the first is worse than what is in hand.
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

      const pages: Record<string, string> = {};

      for (const row of drawn) {
        if (!row.page) continue;

        pages[row.spec.slug] = row.page.html;

        if (row.spec.slug === "archive" || row.spec.slug === "notfound") {
          done[`${row.spec.slug}Css`] = row.page.css;
          done[`${row.spec.slug}Body`] = row.page.body;
        }
      }

      // Every content template in the theme is built around one page hero and
      // one set of .entry rules. The blog post demonstrates both in full, so it
      // is where they come from; any other page will do if the post did not
      // survive, since they all carry the same hero.
      const forTemplate =
        drawn.find((r) => r.page?.slug === "post" && r.page.pageHero)?.page ??
        drawn.find((r) => r.page?.pageHero)?.page ??
        null;

      if (forTemplate) {
        done.innerHtml = forTemplate.html;
        done.innerCss = forTemplate.css;
        done.pageHero = forTemplate.pageHero;
      }

      // Each page's stylesheet holds only what that page adds over the
      // homepage, so together they are the rules every content template needs.
      // The archive and the 404 are left out: they have their own file.
      done.pagesCss = drawn
        .map((r) => r.page)
        .filter(
          (p): p is SitePageResult =>
            Boolean(p?.css) && p!.slug !== "archive" && p!.slug !== "notfound"
        )
        .map((p) => `/* ${p.slug} */\n${p.css}`)
        .join("\n\n");

      done.pageFaults = drawn
        .filter((row) => row.page && fatal(row.failures))
        .map((row) => ({
          slug: row.spec.slug,
          title: row.spec.title,
          codes: row.failures.filter((f) => f.fatal).map((f) => f.code),
        }));

      for (const row of drawn) {
        if (row.page && fatal(row.failures)) {
          console.log(
            `page ${row.spec.slug} shipped with ${fatal(row.failures)} fault(s): ` +
              row.failures.filter((f) => f.fatal).map((f) => f.code).join(", ")
          );
        }
      }

      done.pages = availablePages({
        html: design.html,
        inner_html: done.innerHtml ?? null,
        pages,
        direction,
      });

      await store(db, designId, pages, {
        ...assets,
        innerCss: String(done.innerCss ?? ""),
        pageHero: String(done.pageHero ?? ""),
        pagesCss: String(done.pagesCss ?? ""),
      });

      await finish(db, jobId, done);
    } catch (error) {
      console.error("design-pages job error:", error);

      await db
        .from("ai_jobs")
        .update({
          status: "error",
          error: describeError(error).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }
  });

  return NextResponse.json({ success: true, jobId });
}

async function store(
  db: Db,
  designId: string,
  pages: Record<string, string>,
  assets: Record<string, unknown>
): Promise<void> {
  const patch: Record<string, unknown> = { assets };

  if (Object.keys(pages).length) patch.pages = pages;
  if (typeof assets.pageHero === "string" && assets.pageHero) {
    patch.inner_html = pages.post ?? null;
  }

  const { error } = await db.from("ai_designs").update(patch).eq("id", designId);

  if (error) console.error("design pages store failed:", error.message);
}

async function finish(db: Db, jobId: string, result: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from("ai_jobs")
    .update({ status: "done", result, error: null, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  if (error) console.error("design pages finish failed:", error.message);
}
