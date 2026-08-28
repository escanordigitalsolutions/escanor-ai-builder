import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { SMART_MODEL } from "@/lib/ai/models";
import { moduleEnabled } from "@/lib/entitlements";

/**
 * WordPress -> SaaS single PAGE (Builder, multi-step step 2).
 *
 * Generates ONE page's Gutenberg block markup from its plan entry. The wizard
 * calls this once per page in a loop, so each request is small and fast and the
 * user sees progress. Same strict full-width block rules as the site builder.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = SMART_MODEL;

const BLOCK_RULES = `BLOCK MARKUP RULES — this is critical:
- Output VALID Gutenberg block markup only: every element wrapped in its <!-- wp:... --> ... <!-- /wp:... --> delimiter comments. Never bare HTML or plain text.
- Use core blocks: wp:heading (with {"level":N}), wp:paragraph, wp:buttons + wp:button, wp:list + wp:list-item, wp:columns + wp:column, wp:group, wp:spacer, wp:separator.
- SECTIONS MUST BE FULL-WIDTH BANDS. Wrap every section in a group that has BOTH "align":"full" AND a constrained layout, with vertical padding. "align":"full" makes the background colour span the entire viewport while the constrained layout keeps text centred. A coloured group WITHOUT "align":"full" renders as an ugly narrow box — never do that. Exact shape for each section:
  <!-- wp:group {"align":"full","backgroundColor":"surface","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
  <div class="wp-block-group alignfull has-surface-background-color has-background" style="padding-top:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--70)"> ...section content... </div>
  <!-- /wp:group -->
- Alternate section backgrounds across the page using palette slugs that exist (base, surface, surface-2, and occasionally "contrast" or "primary" for one bold band). On a dark band (contrast/primary background) also set "textColor":"base" on the group and its headings so text stays readable.
- Use padding presets (var:preset|spacing|60 or var:preset|spacing|70) for vertical rhythm, not just spacers.
- Buttons: <!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="/contact">Get in touch</a></div><!-- /wp:button --></div><!-- /wp:buttons -->
- Do NOT use wp:image or any <img> — there are no images yet.
- Write REAL, specific, professional copy — never lorem ipsum. No invented prices, addresses or fake reviews attributed to named people.
- Do not repeat the page title as an H1 (WordPress renders the title). Use H1 only for a home hero; otherwise H2 for section headings.`;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateSiteRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const { context } = auth;
    if (!moduleEnabled(context.modules, "build")) {
      return NextResponse.json({ success: false, error: "The Build module is not enabled on your plan." }, { status: 403 });
    }

    const body = await request.json();
    const brand = str(body.brand).trim().slice(0, 80) || "My Site";
    const tagline = str(body.tagline).trim().slice(0, 160);
    const siteType = str(body.siteType || body.site_type).trim().slice(0, 40) || "business";
    const style = str(body.style).trim().slice(0, 40) || "modern";
    const custom = str(body.custom || body.customPrompt || body.details).trim().slice(0, 3000);

    const page = (body.page && typeof body.page === "object" ? body.page : {}) as Record<string, unknown>;
    const pageTitle = str(page.title).trim().slice(0, 120) || "Home";
    const isFront = Boolean(page.front);
    const purpose = str(page.purpose).trim().slice(0, 300);
    const sections = Array.isArray(page.sections) ? page.sections.map((s) => str(s).trim()).filter(Boolean).slice(0, 8) : [];

    // Other page slugs so internal links point somewhere real.
    const links = Array.isArray(body.slugs) ? body.slugs.map((s: unknown) => str(s).trim()).filter(Boolean).slice(0, 12) : [];

    const instructions = `
You are writing ONE page of a ${style} ${siteType} website as Gutenberg block markup.

Brand: ${brand}
${tagline ? `Tagline: ${tagline}` : ""}
${custom ? `Client instructions (follow closely): ${custom}\n` : ""}
Page: "${pageTitle}"${isFront ? " (this is the HOME page — make it the richest, open with a strong hero: eyebrow + H1 + intro + primary button)" : ""}
${purpose ? `Purpose: ${purpose}` : ""}
${sections.length ? `Build these sections in order, each as its own full-width band: ${sections.join("; ")}.` : "Build 3-6 strong sections."}
${links.length ? `Internal links may point to: ${links.map((s) => "/" + s).join(", ")}.` : ""}

${BLOCK_RULES}

Call submit_page with the complete block markup for this one page.`;

    const submitTool = {
      type: "function" as const,
      name: "submit_page",
      strict: false,
      description: "Return one page's full Gutenberg block markup.",
      parameters: {
        type: "object",
        properties: {
          blocks: { type: "string", description: "The full page body as valid Gutenberg block markup with <!-- wp:... --> delimiters." },
        },
        required: ["blocks"],
        additionalProperties: false,
      },
    };

    const response = await openai.responses.create({
      model: MODEL,
      instructions,
      input: [{ role: "user", content: `Write the "${pageTitle}" page for ${brand}.` }],
      tools: [submitTool],
      tool_choice: { type: "function", name: "submit_page" },
    });

    const call = response.output.find((o) => o.type === "function_call" && o.name === "submit_page");
    if (!call || call.type !== "function_call") {
      return NextResponse.json({ success: false, error: "The model did not return the page." }, { status: 502 });
    }

    const args = JSON.parse(call.arguments) as { blocks?: unknown };
    const blocks = str(args.blocks).slice(0, 80000);

    if (!blocks.trim()) {
      return NextResponse.json({ success: false, error: "The generated page was empty." }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      blocks,
      usage: response.usage
        ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens }
        : null,
      debug: { model: MODEL, input: { brand, page: pageTitle, front: isFront, sections }, prompt: instructions },
    });
  } catch (error) {
    console.error("Build page error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Page generation failed." }, { status: 500 });
  }
}
