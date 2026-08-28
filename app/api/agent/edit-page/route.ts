import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { SMART_MODEL } from "@/lib/ai/models";
import { moduleEnabled } from "@/lib/entitlements";

/**
 * WordPress -> SaaS edit one page (Studio).
 *
 * Given a page's current Gutenberg block markup and an instruction, return the
 * full updated block markup. Same strict full-width section rules as the builder
 * so edits stay consistent with generated pages.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = SMART_MODEL;

const BLOCK_RULES = `BLOCK MARKUP RULES:
- Output VALID Gutenberg block markup only, every element wrapped in <!-- wp:... --> ... <!-- /wp:... --> comments. Never bare HTML or plain text.
- Keep every section a FULL-WIDTH band: a group with BOTH "align":"full" AND a constrained layout and vertical padding, e.g. <!-- wp:group {"align":"full","backgroundColor":"surface","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->...<!-- /wp:group -->. A coloured group WITHOUT "align":"full" renders as an ugly narrow box.
- Palette slugs only: base, contrast, primary, surface, surface-2, border, muted. On dark bands (contrast/primary bg) set "textColor":"base".
- Core blocks only. No wp:image / <img>. Real copy, no lorem, no fake reviews.
- Do not add the page title as an H1 (WordPress renders it) unless this is a home hero.`;

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
    const brand = str(body.brand).trim().slice(0, 80) || "the brand";
    const tagline = str(body.tagline).trim().slice(0, 160);
    const title = str(body.title).trim().slice(0, 120) || "the page";
    const current = str(body.current).slice(0, 120000);
    const instructions = str(body.instructions).trim().slice(0, 3000);

    if (!instructions) {
      return NextResponse.json({ success: false, error: "No instructions were given." }, { status: 400 });
    }

    const prompt = `
You are editing the "${title}" page of ${brand}${tagline ? ` (${tagline})` : ""}.

Apply this change: ${instructions}

Return the COMPLETE updated page as block markup — keep everything that should stay, apply the requested change, and preserve the existing style and structure where the change does not touch it. If the current markup is empty, build the page from scratch to satisfy the request.

CURRENT PAGE MARKUP:
${current || "(empty)"}

${BLOCK_RULES}

Call submit_page with the full updated block markup.`;

    const submitTool = {
      type: "function" as const,
      name: "submit_page",
      strict: false,
      description: "Return the full updated page block markup.",
      parameters: {
        type: "object",
        properties: { blocks: { type: "string", description: "The complete updated page as Gutenberg block markup." } },
        required: ["blocks"],
        additionalProperties: false,
      },
    };

    const response = await openai.responses.create({
      model: MODEL,
      instructions: prompt,
      input: [{ role: "user", content: `Edit the "${title}" page: ${instructions}` }],
      tools: [submitTool],
      tool_choice: { type: "function", name: "submit_page" },
    });

    const call = response.output.find((o) => o.type === "function_call" && o.name === "submit_page");
    if (!call || call.type !== "function_call") {
      return NextResponse.json({ success: false, error: "The model did not return the edited page." }, { status: 502 });
    }

    const args = JSON.parse(call.arguments) as { blocks?: unknown };
    const blocks = str(args.blocks).slice(0, 120000);
    if (!blocks.trim()) {
      return NextResponse.json({ success: false, error: "The edited page was empty." }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      blocks,
      usage: response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens } : null,
      debug: { model: MODEL, input: { title, instructions }, prompt },
    });
  } catch (error) {
    console.error("Edit page error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Edit failed." }, { status: 500 });
  }
}
