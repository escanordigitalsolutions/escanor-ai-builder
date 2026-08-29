import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { pickModel } from "@/lib/ai/resolve";
import { generateText } from "@/lib/ai/provider";

// Blueprint generation can take a while on some models; don't let Vercel's
// plan-default duration kill the function mid-generation.
export const maxDuration = 300;

/**
 * WordPress -> SaaS : theme BLUEPRINT.
 *
 * A deliberately minimal prompt: the model plans pages, sections, palette and
 * fonts from the brief and nothing more. The file list is NOT trusted from the
 * model — normalizeBlueprint() derives it deterministically from pages +
 * sections, so a template can never reference a section file that was never
 * generated.
 */

const INSTRUCTIONS = `You are a web designer planning a classic PHP WordPress theme (NOT a block theme) from a short brief.

Read the brief and decide: the theme name (brief.name if given), the pages the site needs, the sections on each page, a color palette that fits, and a Google Fonts pairing. Honour anything the brief states explicitly. Keep it focused: 3-5 pages, 5-8 unique sections total, reused across pages. Each section's "copy" is one sentence of real, on-topic content direction.

design.fonts.googleUrl must be a valid https://fonts.googleapis.com/css2 URL for the chosen fonts with display=swap.

Respond with ONLY valid JSON — the very first character of your reply is { and the very last is }. No markdown, no fences, no commentary. Use exactly these keys:
{
  "theme": { "name": string, "description": string, "textDomain": string },
  "design": {
    "palette": { "bg": hex, "surface": hex, "fg": hex, "muted": hex, "border": hex, "accent": hex },
    "fonts": { "heading": string, "body": string, "googleUrl": string },
    "radius": string,
    "dark": boolean
  },
  "menu": [ { "title": string, "slug": string } ],
  "frontPage": string,
  "pages": [ { "slug": string, "title": string, "template": string, "sections": [string], "headline": string } ],
  "sections": [ { "slug": string, "type": string, "layout": string, "copy": string } ]
}`;

type Json = Record<string, unknown>;

function extractJson(text: string): Json | null {
  let t = text.trim();
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

const CORE_FILES = [
  "style.css",
  "functions.php",
  "header.php",
  "footer.php",
  "index.php",
  "page.php",
  "single.php",
  "404.php",
  "searchform.php",
  "front-page.php",
  "assets/css/main.css",
  "assets/js/main.js",
];

/**
 * Make the blueprint internally consistent, whatever the model returned:
 * dedupe and cap sections/pages, keep only section references that exist,
 * keep only menu entries that point at real pages, and DERIVE the file list
 * from pages + sections. The model's own "files" (if any) are ignored, so a
 * template can never call a template-part that is missing from the build.
 */
function normalizeBlueprint(bp: Json): void {
  type Section = { slug: string } & Json;
  type Page = { slug: string; sections?: unknown } & Json;

  const rawSections = Array.isArray(bp.sections) ? (bp.sections as unknown[]) : [];
  const seen = new Set<string>();
  const sections: Section[] = [];
  for (const s of rawSections) {
    if (!s || typeof s !== "object") continue;
    const slug = String((s as Json).slug ?? "").trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    sections.push({ ...(s as Json), slug } as Section);
    if (sections.length >= 10) break;
  }

  const front = typeof bp.frontPage === "string" ? bp.frontPage : "";
  const rawPages = Array.isArray(bp.pages) ? (bp.pages as unknown[]) : [];
  const pages: Page[] = [];
  const pageSlugs = new Set<string>();
  for (const p of rawPages) {
    if (!p || typeof p !== "object") continue;
    const slug = String((p as Json).slug ?? "").trim();
    if (!slug || pageSlugs.has(slug)) continue;
    pageSlugs.add(slug);
    const secs = Array.isArray((p as Json).sections)
      ? ((p as Json).sections as unknown[])
          .filter((s): s is string => typeof s === "string" && seen.has(s))
          .slice(0, 6)
      : [];
    pages.push({ ...(p as Json), slug, sections: secs } as Page);
    if (pages.length >= 6) break;
  }

  // Only keep sections that some page actually uses.
  const used = new Set<string>();
  for (const p of pages) {
    for (const s of p.sections as string[]) used.add(s);
  }
  bp.sections = sections.filter((s) => used.has(s.slug));
  bp.pages = pages;

  bp.menu = Array.isArray(bp.menu)
    ? (bp.menu as unknown[]).filter(
        (m) =>
          m &&
          typeof m === "object" &&
          pageSlugs.has(String((m as Json).slug ?? ""))
      )
    : [];

  const files = [...CORE_FILES];
  for (const p of pages) {
    if (p.slug !== front) files.push(`page-${p.slug}.php`);
  }
  for (const s of bp.sections as Section[]) {
    files.push(`template-parts/section-${s.slug}.php`);
  }
  bp.files = files;
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

  let modelConfig: unknown = {};
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("projects")
      .select("model_config")
      .eq("id", auth.context.projectId)
      .single();
    modelConfig = data?.model_config ?? {};
  } catch {
    modelConfig = {};
  }

  let text = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  try {
    const gen = await generateText({
      model: pickModel(modelConfig, "build"),
      system: INSTRUCTIONS,
      input: `Brief:\n${JSON.stringify(brief, null, 2)}`,
      maxTokens: 8000,
    });
    text = gen.text;
    usage = gen.usage;
  } catch (error) {
    console.error("build-plan generate error:", error);
    return NextResponse.json(
      { success: false, error: "The theme planner could not be reached. Try again." },
      { status: 502 }
    );
  }

  const blueprint = extractJson(text);

  if (
    !blueprint ||
    !Array.isArray(blueprint.pages) ||
    !Array.isArray(blueprint.sections)
  ) {
    return NextResponse.json(
      { success: false, error: "The planner did not return a valid blueprint." },
      { status: 502 }
    );
  }

  normalizeBlueprint(blueprint);

  if (
    !Array.isArray(blueprint.files) ||
    (blueprint.sections as unknown[]).length === 0
  ) {
    return NextResponse.json(
      { success: false, error: "The planner did not return a usable blueprint." },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, blueprint, usage });
}
