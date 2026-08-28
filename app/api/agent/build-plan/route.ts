import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { SMART_MODEL } from "@/lib/ai/models";

/**
 * WordPress -> SaaS : theme BLUEPRINT (Phase B).
 *
 * From a short brief the wizard collects, this returns a JSON blueprint for a
 * brand-new CLASSIC PHP theme: design tokens, menu, pages (each with its own
 * template file), the reusable sections, and the complete file list the
 * per-file generator (build-file) will then fill in. Nothing is written here.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INSTRUCTIONS = `You are an expert WordPress theme architect. From the brief, produce a BLUEPRINT for a brand-new CLASSIC PHP theme (NOT a block theme).

Output rules:
- Respond with ONLY valid JSON. No markdown, no code fences, no commentary.
- It must be a classic theme: real .php templates using get_header()/get_footer(), the WordPress loop, get_template_part(), wp_head()/wp_footer().
- Each content page gets its own template file: the front page is front-page.php; every other page is page-{slug}.php.
- Reusable sections live in template-parts/section-{slug}.php and are shared across pages (a page lists the section slugs it uses, in order).
- The files list MUST be complete and buildable, and MUST include at least: style.css, functions.php, header.php, footer.php, index.php, page.php, single.php, 404.php, searchform.php, front-page.php, one page-{slug}.php per non-front page, one template-parts/section-{slug}.php per unique section, assets/css/main.css, assets/js/main.js.
- Choose a coherent palette (hex) and a web-safe / Google Fonts font stack matching the brief's style.
- Keep it reasonable: 4-8 pages, 4-10 unique sections unless the brief clearly asks for more.

JSON schema (use exactly these keys):
{
  "theme": { "name": string, "description": string, "textDomain": string },
  "design": {
    "palette": { "bg": hex, "fg": hex, "muted": hex, "border": hex, "accent": hex, "accent2": hex },
    "fonts": { "heading": string, "body": string },
    "radius": string, "container": string, "dark": boolean, "style": string
  },
  "menu": [ { "title": string, "slug": string } ],
  "frontPage": string,
  "pages": [ { "slug": string, "title": string, "template": string, "sections": [string], "purpose": string, "headline": string } ],
  "sections": [string],
  "files": [string]
}`;

type Json = Record<string, unknown>;

function extractJson(text: string): Json | null {
  let t = text.trim();
  // Strip ```json ... ``` fences if the model added them.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    t = fence[1].trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Json) : null;
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

  let body: Json = {};
  try {
    body = (await request.json()) as Json;
  } catch {
    body = {};
  }

  const brief = body.brief ?? {};

  let response;
  try {
    response = await openai.responses.create({
      model: SMART_MODEL,
      instructions: INSTRUCTIONS,
      input: `Brief:\n${JSON.stringify(brief, null, 2)}`,
    });
  } catch (error) {
    console.error("build-plan OpenAI error:", error);
    return NextResponse.json(
      { success: false, error: "The theme planner could not be reached. Try again." },
      { status: 502 }
    );
  }

  const blueprint = extractJson(response.output_text || "");

  if (
    !blueprint ||
    !Array.isArray((blueprint as { files?: unknown }).files) ||
    ((blueprint as { files: unknown[] }).files.length === 0)
  ) {
    return NextResponse.json(
      { success: false, error: "The planner did not return a valid blueprint." },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, blueprint });
}
