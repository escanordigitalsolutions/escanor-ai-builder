import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { SMART_MODEL } from "@/lib/ai/models";
import { getSiteContentItem } from "@/lib/wordpress/bridge";

/**
 * WordPress -> SaaS content-edit proposal (v3A, Phase 3).
 *
 * Given a content item and a plain-language instruction, the model drafts the
 * new field values. Nothing is written here — this endpoint only PROPOSES the
 * change (before/after per field). The editor renders it for review and the
 * user applies it via /api/agent/content-apply, which is the only writer.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = SMART_MODEL;

const EDITABLE_STATUSES = ["draft", "publish", "pending", "private"];

const submitTool = {
  type: "function" as const,
  name: "submit_edit",
  strict: false,
  description:
    "Return the new values for ONLY the fields that should change. Omit any field that should stay the same. Preserve the existing HTML structure of content unless asked to change it.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One short sentence describing the change, for the user.",
      },
      title: { type: "string", description: "New title (omit if unchanged)." },
      content: {
        type: "string",
        description: "New full HTML content (omit if unchanged).",
      },
      excerpt: { type: "string", description: "New excerpt (omit if unchanged)." },
      status: {
        type: "string",
        enum: EDITABLE_STATUSES,
        description: "New status (omit if unchanged).",
      },
      product: {
        type: "object",
        description: "Product fields to change (WooCommerce products only).",
        properties: {
          regular_price: { type: "string" },
          sale_price: { type: "string" },
          sku: { type: "string" },
          stock_status: {
            type: "string",
            enum: ["instock", "outofstock", "onbackorder"],
          },
        },
        additionalProperties: false,
      },
    },
    required: ["summary"],
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
    const supabase = createServiceClient();

    const body = await request.json();
    const type = str(body.type).trim().slice(0, 40);
    const id = Number.parseInt(String(body.id), 10);
    const instruction = str(body.instruction).trim().slice(0, 2000);

    if (!type || !/^[a-z0-9_-]+$/i.test(type)) {
      return NextResponse.json(
        { success: false, error: "A valid content type is required." },
        { status: 400 }
      );
    }

    if (type === "menu" || type === "media") {
      return NextResponse.json(
        { success: false, error: "Menus and media cannot be edited here yet." },
        { status: 400 }
      );
    }

    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json(
        { success: false, error: "A valid content id is required." },
        { status: 400 }
      );
    }

    if (!instruction) {
      return NextResponse.json(
        { success: false, error: "Describe the change first." },
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

    const current = (await getSiteContentItem(
      site.site_url,
      bridgeToken,
      type,
      id
    )) as { success?: boolean; item?: Record<string, unknown> };

    if (!current || !current.item) {
      return NextResponse.json(
        { success: false, error: "Content not found." },
        { status: 404 }
      );
    }

    const item = current.item as Record<string, any>;

    const instructions = `
You are editing one WordPress ${type}. Produce the new field values by calling submit_edit.

Rules:
- Change ONLY what the instruction asks for. Omit every field that should stay the same.
- Keep the existing HTML structure and shortcodes in content intact unless the instruction is explicitly about restructuring.
- Do not invent facts, prices, or claims. If the instruction asks for information you do not have, make the smallest reasonable change and note it in summary.
- Never include <script>, <style>, <iframe> or event handlers.
- summary must be one short sentence describing what you changed.

Current values:
Title: ${str(item.title)}
Status: ${str(item.status)}
Excerpt: ${str(item.excerpt)}
${item.product ? `Product: ${JSON.stringify(item.product)}` : ""}
Content (HTML):
${str(item.content)}
${item.truncated ? "\n[NOTE: content was truncated for length — do NOT return a content field, only other fields.]" : ""}
`;

    const response = await openai.responses.create({
      model: MODEL,
      instructions,
      input: [{ role: "user", content: instruction }],
      tools: [submitTool],
      tool_choice: { type: "function", name: "submit_edit" },
    });

    const call = response.output.find(
      (o) => o.type === "function_call" && o.name === "submit_edit"
    );

    if (!call || call.type !== "function_call") {
      return NextResponse.json(
        { success: false, error: "The model did not return an edit." },
        { status: 502 }
      );
    }

    const args = JSON.parse(call.arguments) as Record<string, unknown>;

    // Guard: never replace the body of a page whose content we only saw a
    // truncated copy of — that would silently drop the tail.
    const contentTruncated = Boolean(item.truncated);

    const fields: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const changes: Array<{ field: string; before: string; after: string }> = [];

    const considerText = (key: "title" | "content" | "excerpt" | "status") => {
      if (typeof args[key] !== "string") return;
      if (key === "content" && contentTruncated) return;
      const next = String(args[key]);
      const prev = str(item[key]);
      if (next === prev) return;
      fields[key] = next;
      before[key] = prev;
      changes.push({ field: key, before: prev, after: next });
    };

    considerText("title");
    considerText("content");
    considerText("excerpt");
    considerText("status");

    if (
      type === "product" &&
      args.product &&
      typeof args.product === "object" &&
      item.product &&
      typeof item.product === "object"
    ) {
      const p = args.product as Record<string, unknown>;
      const curr = item.product as Record<string, unknown>;
      const prodFields: Record<string, string> = {};
      const prodBefore: Record<string, string> = {};

      for (const key of ["regular_price", "sale_price", "sku", "stock_status"]) {
        if (typeof p[key] !== "string") continue;
        const next = String(p[key]);
        const prev = str(curr[key]);
        if (next === prev) continue;
        prodFields[key] = next;
        prodBefore[key] = prev;
        changes.push({ field: `product.${key}`, before: prev, after: next });
      }

      if (Object.keys(prodFields).length) {
        fields.product = prodFields;
        before.product = prodBefore;
      }
    }

    if (!changes.length) {
      return NextResponse.json({
        success: true,
        proposal: null,
        message:
          contentTruncated && typeof args.content === "string"
            ? "This item is too large to edit its body here — edit it in wp-admin."
            : "No change was needed.",
      });
    }

    return NextResponse.json({
      success: true,
      proposal: {
        type,
        id,
        title: str(item.title),
        url: str(item.url),
        summary: str(args.summary) || "Content update",
        changes,
        fields,
        before,
      },
    });
  } catch (error) {
    console.error("Content propose error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Content proposal failed.",
      },
      { status: 500 }
    );
  }
}
