import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { pickModel } from "@/lib/ai/resolve";
import { generateText } from "@/lib/ai/provider";
import { logUsage } from "@/lib/ai/usage";

export const maxDuration = 120;

/**
 * WordPress -> SaaS : real page content for the inner pages.
 *
 * The blueprint's inner pages used to ship with copy hardcoded in their PHP
 * templates, leaving the actual WordPress pages empty — invisible to SEO
 * plugins, site search, RSS and the WP editor. This cheap call writes the
 * copy as clean HTML per page; the plugin stores it as post_content when it
 * creates the pages, and the templates render it through the_content().
 */

const INSTRUCTIONS = `Write the real page content for the inner pages of a new WordPress site.

Return only JSON:
{"pages":[{"slug":"about","content":"<p>...</p><h2>...</h2><p>...</p>"}]}

Rules:
- One entry per requested page, using the exact slug given.
- content is the page BODY only, as clean semantic HTML: <p>, <h2>, <h3>, <ul>/<li>, <strong>, <em>, <a href="/slug/">. No <h1> (the template renders the title), no images, no inline styles, no classes, no scripts, no wrapper <div>.
- 120-250 words per page, specific to this brand and its voice — never lorem ipsum, never generic filler that could describe any business.
- Write in the same language as the brief.
- A contact page may only use contact details the brief actually provides; otherwise invite contact without inventing addresses, emails or phone numbers.`;

type Json = Record<string, unknown>;

function parseContent(text: string): Record<string, string> | null {
  try {
    let txt = text.trim();
    const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) txt = fence[1].trim();
    const start = txt.indexOf("{");
    const end = txt.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(txt.slice(start, end + 1)) as { pages?: unknown };
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) return null;
    const out: Record<string, string> = {};
    for (const raw of parsed.pages.slice(0, 16)) {
      const p = raw as { slug?: unknown; content?: unknown };
      const slug =
        typeof p.slug === "string" ? p.slug.trim().toLowerCase().slice(0, 80) : "";
      const content = typeof p.content === "string" ? p.content.trim().slice(0, 20000) : "";
      if (!slug || !/^[a-z0-9-]+$/.test(slug) || !content) continue;
      out[slug] = content;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  const { context } = auth;
  const supabase = createServiceClient();

  let body: Json = {};
  try {
    body = (await request.json()) as Json;
  } catch {
    body = {};
  }

  const blueprint =
    body.blueprint && typeof body.blueprint === "object"
      ? (body.blueprint as Json)
      : {};

  const frontSlug =
    typeof blueprint.frontPage === "string" ? blueprint.frontPage.trim() : "";

  const pages: { slug: string; title: string; sections?: unknown }[] = [];
  if (Array.isArray(blueprint.pages)) {
    for (const raw of (blueprint.pages as unknown[]).slice(0, 16)) {
      const p = raw as { slug?: unknown; title?: unknown; sections?: unknown };
      const slug = typeof p.slug === "string" ? p.slug.trim() : "";
      const title = typeof p.title === "string" ? p.title.trim() : "";
      // The front page renders its designed sections — it gets no body copy.
      if (!slug || !title || slug === frontSlug) continue;
      pages.push({
        slug,
        title,
        ...(Array.isArray(p.sections) ? { sections: (p.sections as unknown[]).slice(0, 10) } : {}),
      });
    }
  }

  if (!pages.length) {
    return NextResponse.json({ success: true, content: {} });
  }

  const brief =
    body.brief && typeof body.brief === "object" ? (body.brief as Json) : {};
  const briefName = typeof brief.name === "string" ? brief.name.slice(0, 120) : "";
  const briefPrompt =
    typeof brief.prompt === "string" ? brief.prompt.slice(0, 2000) : "";

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, model_config")
    .eq("id", context.projectId)
    .single();

  if (projectError || !project) {
    return NextResponse.json(
      { success: false, error: "Project not found." },
      { status: 404 }
    );
  }

  const model = pickModel(
    (project as { model_config?: unknown }).model_config,
    "cheap"
  );

  try {
    const gen = await generateText({
      model,
      system: INSTRUCTIONS,
      maxTokens: 8000,
      input:
        `Brief:\n${JSON.stringify({ name: briefName || project.name, prompt: briefPrompt })}` +
        `\n\nPages (write body content for each):\n${JSON.stringify(pages)}`,
    });

    const content = parseContent(gen.text);

    void logUsage(context.projectId, "content", model, gen.usage, {
      pages: pages.map((p) => p.slug),
      generated: content ? Object.keys(content) : null,
      chars: content
        ? Object.values(content).reduce((n, c) => n + c.length, 0)
        : 0,
      truncated: gen.truncated,
    });

    if (!content) {
      return NextResponse.json(
        { success: false, usage: gen.usage, error: "Could not produce page content." },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, content, usage: gen.usage });
  } catch (error) {
    console.error("page-content error:", error);
    return NextResponse.json(
      { success: false, error: "The content writer could not be reached." },
      { status: 502 }
    );
  }
}
