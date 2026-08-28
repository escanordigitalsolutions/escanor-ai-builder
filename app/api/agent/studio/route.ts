import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { FAST_MODEL } from "@/lib/ai/models";
import { moduleEnabled } from "@/lib/entitlements";

/**
 * WordPress -> SaaS Studio router (Builder chat).
 *
 * Given the user's plain-language message and a snapshot of the current project
 * (theme, pages, companion plugin, recent actions), the model picks ONE action
 * for the WordPress side to run. It does not do the work here — it decides and
 * writes a short human reply. The bridge/dashboard then runs the chosen action
 * with the existing operations (generate pages, edit a page, add a page, add
 * booking, generate images) so nothing here is slow.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = FAST_MODEL;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const tools = [
  {
    type: "function" as const,
    name: "reply",
    description: "Answer a question or ask for clarification without changing the site.",
    strict: false,
    parameters: {
      type: "object",
      properties: { message: { type: "string", description: "The answer to show the user." } },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "generate_pages",
    description: "Design and create the starter set of pages (home + a few) and set the home page & menu. Use when the site has no real pages yet or the user asks to (re)build the pages.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Short note to show the user, e.g. 'Building your starter pages…'." },
        custom: { type: "string", description: "Any extra guidance distilled from the request." },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "add_page",
    description: "Add ONE new page to the site and to the menu.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Short note to show the user." },
        title: { type: "string", description: "The new page title, e.g. 'Pricing'." },
        purpose: { type: "string", description: "One sentence on what the page is for." },
        sections: { type: "array", items: { type: "string" }, description: "3-6 ordered section ideas." },
      },
      required: ["message", "title"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "edit_page",
    description: "Change an existing page's content (rewrite, add or remove sections). Use this for 'change the homepage' with slug 'home'.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Short note to show the user." },
        slug: { type: "string", description: "The slug of the page to edit; use 'home' for the homepage." },
        instructions: { type: "string", description: "Exactly what to change, in detail." },
      },
      required: ["message", "instructions"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "edit_design",
    description: "Change the THEME or companion plugin itself — anything that is not page content. Use for: colours, fonts, spacing, button shape, a sticky header, header/footer layout, dark mode, custom blocks or features in the companion plugin, CSS tweaks. These become a reviewed file change with a snapshot and automatic rollback.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Short note to show the user." },
        instructions: { type: "string", description: "Exactly what to change in the theme/plugin, in detail." },
      },
      required: ["message", "instructions"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "add_booking",
    description: "Add a booking feature (form + Bookings + email) to the site's companion plugin.",
    strict: false,
    parameters: {
      type: "object",
      properties: { message: { type: "string", description: "Short note to show the user." } },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "generate_images",
    description: "Generate on-brand AI images and place them on the home page.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Short note to show the user." },
        count: { type: "integer", description: "How many images, 1-4." },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
];

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateSiteRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const { context: ctx } = auth;
    if (!moduleEnabled(ctx.modules, "build")) {
      return NextResponse.json({ success: false, error: "The Build module is not enabled on your plan." }, { status: 403 });
    }

    const body = await request.json();
    const message = str(body.message).trim().slice(0, 4000);
    const project = body.context && typeof body.context === "object" ? body.context : {};

    const instructions = `
You are the ESCANOR Studio — a build assistant embedded in a WordPress site. The user talks to you to build and refine THIS site. Read the current project state, then call exactly ONE tool for what the user asked. Always include a short, friendly "message" for the user in the tool call.

Current project (JSON):
${JSON.stringify(project).slice(0, 6000)}

Guidance:
- If the user wants to change, rewrite or add to the HOME page, call edit_page with slug "home".
- If they want to change another existing page, call edit_page with that page's slug (see pages in the project).
- If they ask to add a single new page (Pricing, FAQ, Team…), call add_page.
- If they want to change the THEME or plugin itself (colours, fonts, spacing, button shape, sticky header, header/footer layout, dark mode, a custom block/feature, CSS) — anything that is not the text/sections of a page — call edit_design with detailed instructions.
- If the site has no real pages yet (only the front page id is 0 or there are no pages) and they want a site/pages, call generate_pages.
- If they ask for booking/reservations, call add_booking. For photos/images, call generate_images.
- If it is a question or unclear, call reply and (if unclear) ask one concise clarifying question.
- Keep messages short and concrete. Never invent that work is done — you are only choosing the next action.`;

    const response = await openai.responses.create({
      model: MODEL,
      instructions,
      input: [{ role: "user", content: message || "Help me build my site." }],
      tools,
      tool_choice: "required",
    });

    const call = response.output.find((o) => o.type === "function_call");
    if (!call || call.type !== "function_call") {
      return NextResponse.json({ success: true, reply: "I'm not sure how to help with that yet — try asking to build pages, edit the home page, add a page, add booking, or add images.", action: null });
    }

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments) as Record<string, unknown>;
    } catch {
      args = {};
    }

    const reply = str(args.message).trim() || "On it.";
    const name = call.name;

    if (name === "reply") {
      return NextResponse.json({ success: true, reply, action: null, usage: response.usage ? { totalTokens: response.usage.total_tokens } : null, debug: { model: MODEL, input: { message }, prompt: instructions } });
    }

    // Whitelist and normalize the action args the bridge will act on.
    const action: { name: string; args: Record<string, unknown> } = { name, args: {} };
    if (name === "generate_pages") {
      action.args = { custom: str(args.custom).slice(0, 2000) };
    } else if (name === "add_page") {
      action.args = {
        title: str(args.title).slice(0, 120),
        purpose: str(args.purpose).slice(0, 300),
        sections: Array.isArray(args.sections) ? (args.sections as unknown[]).map((s) => str(s)).filter(Boolean).slice(0, 8) : [],
      };
    } else if (name === "edit_page") {
      action.args = { slug: str(args.slug).slice(0, 80) || "home", instructions: str(args.instructions).slice(0, 3000) };
    } else if (name === "edit_design") {
      action.args = { instructions: str(args.instructions).slice(0, 3000) };
    } else if (name === "generate_images") {
      let c = Number.parseInt(String(args.count ?? 4), 10);
      if (!Number.isInteger(c) || c < 1) c = 4;
      if (c > 4) c = 4;
      action.args = { count: c };
    } else if (name === "add_booking") {
      action.args = {};
    } else {
      return NextResponse.json({ success: true, reply, action: null });
    }

    return NextResponse.json({
      success: true,
      reply,
      action,
      usage: response.usage ? { totalTokens: response.usage.total_tokens } : null,
      debug: { model: MODEL, input: { message }, prompt: instructions },
    });
  } catch (error) {
    console.error("Studio error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Studio failed." }, { status: 500 });
  }
}
