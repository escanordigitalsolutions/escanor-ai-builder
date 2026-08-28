import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { SMART_MODEL } from "@/lib/ai/models";
import { moduleEnabled } from "@/lib/entitlements";

/**
 * WordPress -> SaaS reusable PATTERNS (Builder, multi-step final step).
 *
 * Generates 6-10 reusable, on-brand section patterns the client can insert
 * anywhere from the block inserter. Run once at the end of the site build.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = SMART_MODEL;

const SECTION_RULE = `Each pattern is ONE self-contained full-width section: a group with BOTH "align":"full" AND a constrained layout and vertical padding, e.g. <!-- wp:group {"align":"full","backgroundColor":"surface","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->...<!-- /wp:group -->. Valid Gutenberg block markup only, core blocks only, real copy (no lorem, no images, no fake reviews). Palette slugs: base, contrast, primary, surface, surface-2, border, muted.`;

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

    const instructions = `
You are creating reusable, on-brand SECTION patterns for a ${style} ${siteType} website called "${brand}"${tagline ? ` (${tagline})` : ""}.

Call submit_patterns with 6-10 patterns the client can insert anywhere from the block inserter — hero, feature grid, stats band, testimonial, pricing table, FAQ, call-to-action, contact block, team grid, steps. Make them genuinely reusable and generic-but-branded.

${SECTION_RULE}`;

    const submitTool = {
      type: "function" as const,
      name: "submit_patterns",
      strict: false,
      description: "Return reusable section patterns as Gutenberg block markup.",
      parameters: {
        type: "object",
        properties: {
          patterns: {
            type: "array",
            description: "6-10 reusable section patterns.",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Human name for the inserter, e.g. 'Feature grid'." },
                slug: { type: "string", description: "Short lowercase hyphenated id." },
                blocks: { type: "string", description: "The section as valid Gutenberg block markup (one full-width wp:group root)." },
              },
              required: ["title", "blocks"],
              additionalProperties: false,
            },
          },
        },
        required: ["patterns"],
        additionalProperties: false,
      },
    };

    const response = await openai.responses.create({
      model: MODEL,
      instructions,
      input: [{ role: "user", content: `Create the section patterns for ${brand}.` }],
      tools: [submitTool],
      tool_choice: { type: "function", name: "submit_patterns" },
    });

    const call = response.output.find((o) => o.type === "function_call" && o.name === "submit_patterns");
    if (!call || call.type !== "function_call") {
      return NextResponse.json({ success: false, error: "The model did not return patterns." }, { status: 502 });
    }

    const args = JSON.parse(call.arguments) as { patterns?: unknown };
    const rawPatterns = Array.isArray(args.patterns) ? args.patterns : [];

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

    return NextResponse.json({
      success: true,
      patterns,
      usage: response.usage
        ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens }
        : null,
      debug: { model: MODEL, input: { brand, tagline, siteType, style }, prompt: instructions },
    });
  } catch (error) {
    console.error("Build patterns error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Pattern generation failed." }, { status: 500 });
  }
}
