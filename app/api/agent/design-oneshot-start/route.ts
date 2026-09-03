import { NextRequest, NextResponse, after } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { generateOneshot } from "@/lib/agent/oneshot-core";
import { splitMockup } from "@/lib/agent/mockup-core";
import { availablePages, titleFromSlug } from "@/lib/agent/design-pages";
import { renderThumbnail } from "@/lib/agent/thumbnail";
import { recordUsage } from "@/lib/ai/usage";
import { refundJobUsage } from "@/lib/billing/credits";
import { describeError } from "@/lib/debug";

/**
 * WordPress -> SaaS : the one-shot experiment as a job.
 *
 * One model call, three pages, stored as an ordinary design row — so the
 * preview rail, the walkable links, the thumbnail, the edit loop and the build
 * all work on it without knowing which path made it. The wizard lands straight
 * on the full review (the pages already exist, so the homepage gate never
 * shows), and "Build the theme" goes through the same door as always.
 */

export const maxDuration = 800;

const BUDGET_MS = maxDuration * 1000;

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

  const brief = body.brief ?? {};
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
    .insert({ project_id: projectId, kind: "oneshot", status: "running" })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("design-oneshot-start job insert error:", jobError);
    return NextResponse.json(
      { success: false, error: "Could not start the design job." },
      { status: 500 }
    );
  }

  const jobId = job.id as string;

  after(async () => {
    const db = createServiceClient();
    const msLeft = () => BUDGET_MS - (Date.now() - requestStart);

    const setProgress = async (note: string) => {
      await db
        .from("ai_jobs")
        .update({
          result: { progress: { stage: "design", note } },
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .then(
          () => {},
          () => {}
        );
    };

    try {
      await setProgress("One prompt, three pages…");

      const gen = await generateOneshot(modelConfig, brief, Math.max(60_000, msLeft() - 90_000));

      await recordUsage(projectId, "design", gen.model, gen.usage, {
        oneshot: true,
        pages: gen.pages.map((p) => p.slug),
        truncated: gen.truncated,
      }, jobId);

      const home = gen.pages.find((p) => p.slug === "home");

      if (!home) {
        throw new Error(
          gen.truncated
            ? "The one-shot reply was cut off before a complete homepage arrived."
            : "The one-shot reply contained no homepage."
        );
      }

      // The same pieces the staged path stores, cut from the same splitter, so
      // every downstream reader is path-blind.
      const split = splitMockup(home.html);
      const pages: Record<string, string> = {};

      for (const page of gen.pages) {
        if (page.slug !== "home") pages[page.slug] = page.html;
      }

      const { data: row, error: insertError } = await db
        .from("ai_designs")
        .insert({
          project_id: projectId,
          job_id: jobId,
          shape: "oneshot",
          concept: null,
          brief: { jobId, concept: null, input: brief },
          model: gen.model,
          html: home.html,
          pages,
          assets: {
            css: split.css,
            header: split.header,
            footer: split.footer,
            fonts: split.fonts,
            sections: split.sections,
          },
          direction: null,
          validation: [],
          retried: false,
          status: "pending",
          input_tokens: gen.usage.inputTokens,
          output_tokens: gen.usage.outputTokens,
        })
        .select("id")
        .single();

      if (insertError) console.error("oneshot archive failed:", insertError.message);

      const designId = (row?.id as string | undefined) ?? null;

      // The picture, same as the staged path. Non-fatal.
      let thumbVersion = 0;
      if (designId && msLeft() > 45_000) {
        await setProgress("Taking the preview picture…");
        try {
          const thumb = await renderThumbnail(home.html);
          if (thumb) {
            await db
              .from("ai_designs")
              .update({
                assets: {
                  css: split.css,
                  header: split.header,
                  footer: split.footer,
                  fonts: split.fonts,
                  sections: split.sections,
                  thumb,
                },
              })
              .eq("id", designId);
            thumbVersion = thumb.version;
          }
        } catch (thumbError) {
          console.error("oneshot thumbnail error (continuing):", thumbError);
        }
      }

      // The wizard's result payload — the shape showMockup already reads, with
      // the pages present so the review opens past the homepage gate.
      const done: Record<string, unknown> = {
        success: true,
        designId,
        oneshot: true,
        conceptName: null,
        conceptIdea: null,
        signatureMove: null,
        critique: null,
        html: home.html,
        css: split.css,
        header: split.header,
        footer: split.footer,
        fonts: split.fonts,
        sections: split.sections,
        colorways: [],
        thumbVersion,
        // The build inherits these instead of inventing pages.
        sitePages: Object.keys(pages).map((slug) => ({
          slug,
          title: titleFromSlug(slug),
          purpose: "",
        })),
        pages: availablePages({ html: home.html, pages, direction: null }),
        usage: gen.usage,
        model: gen.model,
        truncated: gen.truncated,
      };

      await db
        .from("ai_jobs")
        .update({ status: "done", result: done, error: null, updated_at: new Date().toISOString() })
        .eq("id", jobId);
    } catch (error) {
      console.error("design-oneshot job error:", error);

      await refundJobUsage(jobId, "Refund: one-shot design failed").catch(() => {});
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
