import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { SMART_MODEL } from "@/lib/ai/models";
import { moduleEnabled } from "@/lib/entitlements";

/**
 * WordPress -> SaaS site PLAN (Builder, multi-step step 1).
 *
 * A fast, small call: from the brief the model returns just the site map —
 * which pages to build and, for each, a short purpose and a list of section
 * ideas. No block markup here (that is generated per page in build-page), so
 * this returns quickly and the wizard can show the plan immediately.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = SMART_MODEL;

const submitTool = {
  type: "function" as const,
  name: "submit_plan",
  strict: false,
  description: "Return the planned site map: the pages to build and each page's sections.",
  parameters: {
    type: "object",
    properties: {
      pages: {
        type: "array",
        description: "4-8 pages. Exactly one has front=true (the home page).",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Page title, e.g. 'Services'." },
            slug: { type: "string", description: "Lowercase hyphenated slug; home slug 'home'." },
            front: { type: "boolean", description: "True for the single home page." },
            purpose: { type: "string", description: "One sentence on what this page is for." },
            sections: {
              type: "array",
              description: "3-6 short section ideas for this page, in order (e.g. 'hero', 'services grid', 'process steps', 'testimonial', 'CTA').",
              items: { type: "string" },
            },
          },
          required: ["title", "sections"],
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

    const instructions = `
You are planning a small but COMPLETE WordPress website for a new site. Return ONLY the plan (site map), not any page content.

Brand: ${brand}
${tagline ? `Tagline: ${tagline}` : ""}
Site type: ${siteType}
Style: ${style}
${custom ? `\nCLIENT'S SPECIFIC INSTRUCTIONS (follow closely, they override generic choices):\n${custom}\n` : ""}
Call submit_plan with 4-8 pages appropriate to a ${siteType} site. Exactly ONE page has front=true — the home page — and it should be the richest (5-7 sections). Choose the pages that fit a ${siteType}: e.g. Home, About, Services (or Menu/Portfolio/Shop), Pricing, FAQ, Gallery, Team, Contact. For each page give a one-sentence purpose and 3-6 ordered section ideas (short labels). Home slug must be "home"; other slugs lowercase and hyphenated.`;

    const response = await openai.responses.create({
      model: MODEL,
      instructions,
      input: [{ role: "user", content: `Plan the website for ${brand}.` }],
      tools: [submitTool],
      tool_choice: { type: "function", name: "submit_plan" },
    });

    const call = response.output.find((o) => o.type === "function_call" && o.name === "submit_plan");
    if (!call || call.type !== "function_call") {
      return NextResponse.json({ success: false, error: "The model did not return a plan." }, { status: 502 });
    }

    const args = JSON.parse(call.arguments) as { pages?: unknown };
    const rawPages = Array.isArray(args.pages) ? args.pages : [];

    const pages = rawPages
      .map((p) => {
        const page = p as Record<string, unknown>;
        const sections = Array.isArray(page.sections) ? page.sections.map((s) => str(s).trim().slice(0, 80)).filter(Boolean).slice(0, 8) : [];
        return {
          title: str(page.title).trim().slice(0, 120),
          slug: str(page.slug).trim().slice(0, 80),
          front: Boolean(page.front),
          purpose: str(page.purpose).trim().slice(0, 300),
          sections,
        };
      })
      .filter((p) => p.title && p.sections.length)
      .slice(0, 8);

    if (!pages.length) {
      return NextResponse.json({ success: false, error: "No usable pages were planned." }, { status: 502 });
    }
    if (!pages.some((p) => p.front)) {
      pages[0].front = true;
    }

    return NextResponse.json({
      success: true,
      pages,
      usage: response.usage
        ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens }
        : null,
      debug: { model: MODEL, input: { brand, tagline, siteType, style, custom }, prompt: instructions },
    });
  } catch (error) {
    console.error("Build plan error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Planning failed." }, { status: 500 });
  }
}
