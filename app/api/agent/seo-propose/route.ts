import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { SMART_MODEL } from "@/lib/ai/models";
import { getSiteContentItem } from "@/lib/wordpress/bridge";
import { moduleEnabled } from "@/lib/entitlements";

/**
 * WordPress -> SaaS SEO proposal (SEO module).
 *
 * Given a content item and its current SEO fields (read locally from the active
 * SEO plugin and passed in), the model drafts an optimized meta title, meta
 * description and focus keyword from the real page body. Nothing is written
 * here — WordPress applies the result into Yoast / Rank Math via
 * /editor/seo/apply, which is the only writer.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = SMART_MODEL;

const submitTool = {
  type: "function" as const,
  name: "submit_seo",
  strict: false,
  description:
    "Return the optimized SEO fields for this page. Base them on the real page content, not invented claims.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One short sentence describing what you improved, for the user.",
      },
      metaTitle: {
        type: "string",
        description:
          "SEO title, ~50-60 characters, front-loaded with the primary keyword. Plain text, no site name suffix.",
      },
      metaDescription: {
        type: "string",
        description:
          "Meta description, ~140-155 characters, compelling and accurate, includes the focus keyword naturally.",
      },
      focusKeyword: {
        type: "string",
        description: "The single primary focus keyword or key phrase (1-4 words).",
      },
    },
    required: ["summary", "metaTitle", "metaDescription", "focusKeyword"],
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

    // Server-side module lock. The plugin gates the UI; this is the real gate.
    if (!moduleEnabled(context.modules, "seo")) {
      return NextResponse.json(
        { success: false, error: "The SEO module is not enabled on your plan." },
        { status: 403 }
      );
    }

    const supabase = createServiceClient();

    const body = await request.json();
    const type = str(body.type).trim().slice(0, 40);
    const id = Number.parseInt(String(body.id), 10);
    const current =
      body.current && typeof body.current === "object"
        ? (body.current as Record<string, unknown>)
        : {};

    if (!type || !/^[a-z0-9_-]+$/i.test(type)) {
      return NextResponse.json(
        { success: false, error: "A valid content type is required." },
        { status: 400 }
      );
    }

    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json(
        { success: false, error: "A valid content id is required." },
        { status: 400 }
      );
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select(`
        id,
        name,
        wordpress_sites (
          site_url,
          bridge_token_encrypted
        )
      `)
      .eq("id", context.projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 }
      );
    }

    const wordpressSites = project.wordpress_sites;
    const site = Array.isArray(wordpressSites)
      ? wordpressSites[0]
      : wordpressSites;

    if (!site || !site.site_url || !site.bridge_token_encrypted) {
      return NextResponse.json(
        { success: false, error: "WordPress connection is missing." },
        { status: 400 }
      );
    }

    const bridgeToken = decryptSecret(site.bridge_token_encrypted);

    const fetched = (await getSiteContentItem(
      site.site_url,
      bridgeToken,
      type,
      id
    )) as { success?: boolean; item?: Record<string, unknown> };

    const item = (fetched && fetched.item ? fetched.item : {}) as Record<string, unknown>;

    const bodyText = str(item.content).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const instructions = `
You are optimizing on-page SEO for one WordPress ${type}. Call submit_seo with the improved fields.

Rules:
- Base everything on the ACTUAL page content below. Do not invent facts, offers or claims.
- metaTitle: ~50-60 characters, primary keyword near the front, plain text (no "| Site Name").
- metaDescription: ~140-155 characters, accurate and compelling, include the focus keyword naturally, active voice.
- focusKeyword: the single most relevant search phrase for this page (1-4 words).
- Keep it truthful to the page. If the page is thin, do the best honest job and say so in summary.

Page title: ${str(item.title) || str(current.title)}
Slug: ${str(item.slug) || str(current.slug)}
Current meta title: ${str(current.metaTitle) || "(none)"}
Current meta description: ${str(current.metaDescription) || "(none)"}
Current focus keyword: ${str(current.focusKeyword) || "(none)"}

Page content (plain text, may be truncated):
${bodyText.slice(0, 6000)}
`;

    const response = await openai.responses.create({
      model: MODEL,
      instructions,
      input: [
        {
          role: "user",
          content: "Optimize the SEO title, meta description and focus keyword for this page.",
        },
      ],
      tools: [submitTool],
      tool_choice: { type: "function", name: "submit_seo" },
    });

    const call = response.output.find(
      (o) => o.type === "function_call" && o.name === "submit_seo"
    );

    if (!call || call.type !== "function_call") {
      return NextResponse.json(
        { success: false, error: "The model did not return SEO fields." },
        { status: 502 }
      );
    }

    const args = JSON.parse(call.arguments) as Record<string, unknown>;

    const proposed: Record<"metaTitle" | "metaDescription" | "focusKeyword", string> = {
      metaTitle: str(args.metaTitle).trim().slice(0, 70),
      metaDescription: str(args.metaDescription).trim().slice(0, 165),
      focusKeyword: str(args.focusKeyword).trim().slice(0, 100),
    };

    const fields: Record<string, string> = {};
    const before: Record<string, string> = {};
    const changes: Array<{ field: string; before: string; after: string }> = [];

    (["metaTitle", "metaDescription", "focusKeyword"] as const).forEach((key) => {
      const next = proposed[key];
      const prev = str(current[key]);
      if (!next || next === prev) return;
      fields[key] = next;
      before[key] = prev;
      changes.push({ field: key, before: prev, after: next });
    });

    if (!changes.length) {
      return NextResponse.json({
        success: true,
        proposal: null,
        message: "The current SEO is already in good shape.",
      });
    }

    return NextResponse.json({
      success: true,
      proposal: {
        type,
        id,
        title: str(item.title) || str(current.title),
        url: str(item.url) || str(current.url),
        summary: str(args.summary) || "SEO improvements",
        changes,
        fields,
        before,
      },
    });
  } catch (error) {
    console.error("SEO propose error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "SEO proposal failed.",
      },
      { status: 500 }
    );
  }
}
