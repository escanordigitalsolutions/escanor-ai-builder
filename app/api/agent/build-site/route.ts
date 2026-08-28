import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { SMART_MODEL } from "@/lib/ai/models";
import { moduleEnabled } from "@/lib/entitlements";

/**
 * WordPress -> SaaS site generation (Builder, B1b).
 *
 * From a short brief the model designs a small, complete site as Gutenberg
 * block markup: a few pages, each with real, brand-specific sections. Nothing
 * is written here — the pages are returned and WordPress creates them (as its
 * own published pages) through the Builder, which also sets the front page.
 *
 * Images are intentionally omitted at this stage (they arrive in a later Builder
 * phase); sections use coloured group/heading/paragraph/button layouts instead.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = SMART_MODEL;

const submitTool = {
  type: "function" as const,
  name: "submit_site",
  strict: false,
  description:
    "Return the generated site as an array of pages, each with valid WordPress block markup.",
  parameters: {
    type: "object",
    properties: {
      pages: {
        type: "array",
        description: "4-8 pages. Exactly one page must have front=true (the home page).",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Page title." },
            slug: { type: "string", description: "URL slug (lowercase, hyphenated)." },
            front: { type: "boolean", description: "True for the single home page." },
            blocks: {
              type: "string",
              description:
                "The full page body as valid Gutenberg block markup with <!-- wp:... --> delimiters. Compose SEVERAL distinct sections, each wrapped in a wp:group.",
            },
          },
          required: ["title", "blocks"],
          additionalProperties: false,
        },
      },
      patterns: {
        type: "array",
        description:
          "6-10 reusable, on-brand section patterns the client can insert anywhere from the WordPress block inserter (hero, feature grid, stats, testimonial, pricing, FAQ, call-to-action, contact, team, gallery, steps). Each is one self-contained section as block markup.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Human name shown in the inserter, e.g. 'Feature grid'." },
            slug: { type: "string", description: "Short lowercase hyphenated id, e.g. 'feature-grid'." },
            blocks: { type: "string", description: "The section as valid Gutenberg block markup (one wp:group root)." },
          },
          required: ["title", "blocks"],
          additionalProperties: false,
        },
      },
    },
    required: ["pages"],
    additionalProperties: false,
  },
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateSiteRequest(request);

    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { context } = auth;

    if (!moduleEnabled(context.modules, "build")) {
      return NextResponse.json(
        { success: false, error: "The Build module is not enabled on your plan." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const brand = str(body.brand).trim().slice(0, 80) || "My Site";
    const tagline = str(body.tagline).trim().slice(0, 160);
    const siteType = str(body.siteType || body.site_type).trim().slice(0, 40) || "business";
    const style = str(body.style).trim().slice(0, 40) || "modern";
    const custom = str(body.custom || body.customPrompt || body.details).trim().slice(0, 3000);

    const instructions = `
You are designing a small but COMPLETE WordPress website as Gutenberg block markup for a new site.

Brand: ${brand}
${tagline ? `Tagline: ${tagline}` : ""}
Site type: ${siteType}
Style: ${style}
${custom ? `\nCLIENT'S SPECIFIC INSTRUCTIONS (follow these closely — they override the generic guidance where they conflict, as long as the output stays valid Gutenberg block markup):\n${custom}\n` : ""}
Call submit_site with 4-8 pages appropriate to a ${siteType} site, PLUS 6-10 reusable section "patterns".

Pages: Exactly ONE page has front=true — the home page — and it must be the richest: a hero (a large heading + a short intro paragraph + a primary button), then 4-6 more sections (services/features grid, about, a stats or "why us" band, a testimonial-style quote, an FAQ or steps section, and a closing call-to-action). Build a FULL site — choose the pages that fit a ${siteType}: e.g. About, Services (or Menu/Portfolio/Shop), Pricing, FAQ, Gallery, Team, Blog, Contact. Every non-home page should still have 2-4 real sections, not a single block.

Patterns: also return 6-10 reusable, on-brand SECTION patterns (each a single self-contained wp:group section) the client can insert anywhere from the block inserter — e.g. hero, feature grid, stats band, testimonial, pricing table, FAQ, call-to-action, contact block, team grid, gallery placeholder. Make them genuinely reusable and generic-but-branded.

BLOCK MARKUP RULES — this is critical:
- Output VALID Gutenberg block markup only: every element wrapped in its <!-- wp:... --> ... <!-- /wp:... --> delimiter comments. Never bare HTML or plain text.
- Use core blocks: wp:heading (with {"level":N}), wp:paragraph, wp:buttons + wp:button, wp:list + wp:list-item, wp:columns + wp:column, wp:group, wp:spacer, wp:separator.
- SECTIONS MUST BE FULL-WIDTH BANDS. Wrap every section in a group that has BOTH "align":"full" AND a constrained layout, with vertical padding. This is the single most important rule: "align":"full" makes the background colour span the entire viewport while the constrained layout keeps text centred. A coloured group WITHOUT "align":"full" renders as an ugly narrow box in the middle of the page — never do that. Exact shape for each section:
  <!-- wp:group {"align":"full","backgroundColor":"surface","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
  <div class="wp-block-group alignfull has-surface-background-color has-background" style="padding-top:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--70)"> ...section content... </div>
  <!-- /wp:group -->
- Alternate the section backgrounds across the page using palette slugs that exist (base, surface, surface-2, and occasionally "contrast" or "primary" for one bold band). When you use a dark band (contrast/primary background) also set a light "textColor":"base" on the group and on its headings so text stays readable.
- Use padding presets (var:preset|spacing|60 or var:preset|spacing|70) for the vertical rhythm of each band, not just spacers.
- For multi-column layouts use wp:columns + wp:column inside the section; they will sit at the constrained content width automatically.
- Buttons: <!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="/contact">Get in touch</a></div><!-- /wp:button --></div><!-- /wp:buttons -->
- Do NOT use wp:image or any <img> — there are no images yet.
- Write REAL, specific, professional copy for "${brand}"${tagline ? ` (${tagline})` : ""} — never lorem ipsum. Keep claims generic and truthful where details are unknown (no invented prices, addresses or fake reviews attributed to named people).
- Do not include the page title as an H1 inside the body (WordPress renders the title). Start hero sections at H1 only on the home page hero if appropriate; otherwise use H2 for section headings.
- Slugs: lowercase, hyphenated. Home slug "home".

Keep each page focused; the whole site should feel cohesive and on-brand for a ${style} ${siteType}.`;

    const response = await openai.responses.create({
      model: MODEL,
      instructions,
      input: [
        { role: "user", content: `Generate the website for ${brand}.` },
      ],
      tools: [submitTool],
      tool_choice: { type: "function", name: "submit_site" },
    });

    const call = response.output.find(
      (o) => o.type === "function_call" && o.name === "submit_site"
    );

    if (!call || call.type !== "function_call") {
      return NextResponse.json(
        { success: false, error: "The model did not return a site." },
        { status: 502 }
      );
    }

    const args = JSON.parse(call.arguments) as { pages?: unknown; patterns?: unknown };
    const rawPages = Array.isArray(args.pages) ? args.pages : [];
    const rawPatterns = Array.isArray(args.patterns) ? args.patterns : [];

    const pages = rawPages
      .map((p) => {
        const page = p as Record<string, unknown>;
        return {
          title: str(page.title).trim().slice(0, 120),
          slug: str(page.slug).trim().slice(0, 80),
          front: Boolean(page.front),
          blocks: str(page.blocks).slice(0, 80000),
        };
      })
      .filter((p) => p.title && p.blocks)
      .slice(0, 8);

    const patterns = rawPatterns
      .map((p) => {
        const pat = p as Record<string, unknown>;
        return {
          title: str(pat.title).trim().slice(0, 80),
          slug: str(pat.slug).trim().slice(0, 60),
          blocks: str(pat.blocks).slice(0, 40000),
        };
      })
      .filter((p) => p.title && p.blocks)
      .slice(0, 12);

    if (!pages.length) {
      return NextResponse.json(
        { success: false, error: "No usable pages were generated." },
        { status: 502 }
      );
    }

    // Guarantee exactly one front page.
    if (!pages.some((p) => p.front)) {
      pages[0].front = true;
    }

    return NextResponse.json({
      success: true,
      pages,
      patterns,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : null,
      // Echoed so the WordPress bridge can store a full audit log of what was
      // asked and what the model was told (the exact prompt) for this account.
      debug: {
        model: MODEL,
        input: { brand, tagline, siteType, style, custom },
        prompt: instructions,
      },
    });
  } catch (error) {
    console.error("Build site error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Site generation failed.",
      },
      { status: 500 }
    );
  }
}
