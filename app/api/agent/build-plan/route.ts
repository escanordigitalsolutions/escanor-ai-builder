import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { pickModel } from "@/lib/ai/resolve";
import { generateText } from "@/lib/ai/provider";
import { logUsage } from "@/lib/ai/usage";
import {
  normalizeBlueprint,
  type Json,
  type SitePage,
} from "@/lib/agent/blueprint";

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

const INSTRUCTIONS = `Plan a classic PHP WordPress theme from the brief.

Decide the theme name (brief.name if given), the pages, the sections they are built from, the templates the theme needs, a colour palette and a Google Fonts pairing (a valid https://fonts.googleapis.com/css2 URL with display=swap).

SCOPE — plan the site this business would really have

- 5 to 8 pages. A one-line brief is the normal case, not a reason to plan three pages: work out what this kind of business needs a visitor to be able to read, and plan those pages. For most businesses that means a home page, what they do, how they work, who they are, something that answers objections, and a way to get in touch.
- 8 to 14 unique sections, reused across pages. A section used on one page only is usually a page that needed its own idea; a section used on four pages is the theme earning its keep.
- The templates WordPress needs to render the site: front-page, a general page, any page-<slug> that genuinely differs, single, archive, search and 404.

GLOBAL PARAMETERS — this is what keeps it one site

Every page, section and template draws from the same set: one palette, one type pairing, one spacing rhythm, one radius, one button treatment, one card treatment, one section-heading treatment. Name them once here; nothing invents its own. A theme where the services page has its own heading style and the about page has another is five designs sharing a menu.

CONTENT — the theme arrives populated

Each section's "copy" is the brief for what that section SAYS, and it has to be countable: how many items it holds and what each one carries. "Three service blocks, each a short title and 30-50 words on the problem it solves" is a brief. "Explain the services" is not — it comes back as three labels.

Write for a site that goes live tomorrow. Where the brief gives no specifics, invent them: figures, timeframes, plan names, prices, example projects, questions customers ask, a quote attributed to a role. Keep them plausible and consistent across the theme. The owner will replace what is not true of their business, and editing a real sentence is easier than filling an empty box. Two exceptions, because editing does not make them true: no real company names or logos, and no quote attributed to a named individual.

Reply with ONLY this JSON — first character {, last }:
{
  "theme": { "name": string, "description": string, "textDomain": string },
  "design": {
    "palette": { "bg": hex, "surface": hex, "fg": hex, "muted": hex, "border": hex, "accent": hex },
    "fonts": { "heading": string, "body": string, "googleUrl": string },
    "radius": string, "dark": boolean,
    "rhythm": string, "buttons": string, "cards": string, "headings": string
  },
  "menu": [ { "title": string, "slug": string } ],
  "frontPage": string,
  "pages": [ { "slug": string, "title": string, "template": string, "sections": [string], "headline": string } ],
  "sections": [ { "slug": string, "type": string, "layout": string, "copy": string } ]
}`;

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

// Componentized layout: CSS is split per component so every file stays small
// and later edits touch one small file instead of one giant stylesheet.

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
  const mockupSections = Array.isArray(body.mockupSections)
    ? (body.mockupSections as unknown[])
        .filter((x): x is string => typeof x === "string" && /^[a-z0-9-]+$/.test(x))
        .slice(0, 10)
    : [];

  // The pages the art director planned, carried through the design stage. When
  // they are here the blueprint does not get to invent its own site map.
  const sitePages: SitePage[] = (Array.isArray(body.sitePages) ? body.sitePages : [])
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Json;
      const slug = String(row.slug ?? "").trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(slug) || slug === "home") return [];
      return [
        {
          slug,
          title: String(row.title ?? slug).trim().slice(0, 60) || slug,
          purpose: String(row.purpose ?? "").trim().slice(0, 200),
        },
      ];
    })
    .slice(0, 7);

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
  const planModel = pickModel(modelConfig, "plan");
  try {
    const gen = await generateText({
      model: planModel,
      system: INSTRUCTIONS,
      input:
        `Brief:\n${JSON.stringify(brief, null, 2)}` +
        (mockupSections.length
          ? `\n\nThe homepage is ALREADY DESIGNED and approved with these sections, in this order: ${mockupSections.join(
              ", "
            )}. Use ONLY these section slugs across all pages — do not invent new sections. The front page uses all of them in this exact order. Plan the other pages by reusing the most fitting of these sections.`
          : "") +
        (sitePages.length
          ? `\n\nThe SITE MAP is already decided and the approved design's navigation links to it. Plan exactly these pages besides the front page — same slugs, same titles, no additions and no omissions:\n${sitePages
              .map((p) => `- /${p.slug} — ${p.title}: ${p.purpose}`)
              .join("\n")}\nThe menu is these pages in this order.`
          : ""),
      maxTokens: 8000,
    });
    text = gen.text;
    usage = gen.usage;
    void logUsage(auth.context.projectId, "plan", planModel, gen.usage);
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

  normalizeBlueprint(blueprint, mockupSections, sitePages);

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
