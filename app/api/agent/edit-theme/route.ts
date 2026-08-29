import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { pickModel } from "@/lib/ai/resolve";
import { runToolLoop, type ToolDef } from "@/lib/ai/toolloop";
import { logUsage } from "@/lib/ai/usage";
import { listProjectFiles, readProjectFiles } from "@/lib/wordpress/bridge";

// Model calls can run long; don't let Vercel's plan-default duration kill the
// function mid-generation.
export const maxDuration = 300;


/**
 * WordPress -> SaaS : edit the active generated theme.
 *
 * Given a plain-language instruction, this inspects the theme's real files
 * (read-only, over the bridge), decides the minimal set of files to change and
 * returns their complete new contents. The WordPress side writes them via the
 * WPAB_Theme_Writer::update() path (only the generated theme, validated, with a
 * one-level undo). Nothing is written here.
 */

const INSTRUCTIONS = `Edit the active classic PHP WordPress theme per the instruction. Work in steps — understand first, change second.

1. The theme's file structure is provided in the message. Read the files you plan to change PLUS assets/css/main.css with read_project_files before writing anything.
2. After reading, if you discover the change also involves other files (a template part, functions.php, main.js), read those too — several read rounds are expected and encouraged. Never edit a file you have not read in this conversation.
3. Fewest files possible; reuse existing classes and design tokens; responsive; COMPLETE file contents, never diffs.
4. No JS libraries. Never require/include a PHP file that does not exist in the theme. No PHP that executes code or touches filesystem/network (eval, exec, file_get_contents, fopen, curl_exec, wp_remote_*, base64_decode, call_user_func, preg_replace_callback...).
Final reply (no tool calls), starting with the first characters "SUMMARY:" — one sentence saying WHAT changed and WHERE, in plain user-facing language:
SUMMARY: <one sentence>
===WPAB_FILE:<path>===
<complete new contents>
===WPAB_END===`;

const tools: ToolDef[] = [
  {
    name: "list_project_files",
    description:
      "Re-list the readable theme files (the structure is already in the message; call this only if it seems stale).",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "read_project_files",
    description:
      "Read the full contents of up to 8 theme files by their relative paths (from list_project_files).",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
];

type Json = Record<string, unknown>;

function parseOutput(text: string): { summary: string; files: { path: string; contents: string }[] } {
  const files: { path: string; contents: string }[] = [];
  // Split on the FILE marker so a missing/malformed ===WPAB_END=== can't merge
  // adjacent files; each file's content runs until the next FILE marker.
  const parts = text.split(/===\s*WPAB_FILE\s*:/);
  for (let i = 1; i < parts.length; i++) {
    const m = parts[i].match(/^\s*([^\n=]+?)\s*===\s*\r?\n?([\s\S]*)$/);
    if (!m) {
      continue;
    }
    const path = m[1].trim().replace(/^`+|`+$/g, "");
    let contents = m[2].replace(/^﻿/, "");
    contents = contents.replace(/\n?===\s*WPAB_END\s*===[\s\S]*$/, "");
    if (path) {
      files.push({ path, contents: contents.replace(/\s+$/, "") + "\n" });
    }
  }
  const sm = text.match(/SUMMARY:\s*(.+)/);
  return { summary: sm ? sm[1].trim() : "Updated the theme.", files };
}

function validatePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .slice(0, 8);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  const { context } = auth;
  const supabase = createServiceClient();

  let body: Json = {};
  try {
    body = (await request.json()) as Json;
  } catch {
    body = {};
  }

  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";

  // Optional execution plan from the edit-plan stage: a queue of steps the
  // model follows in order.
  const planSteps: { title: string; detail: string; files: string[] }[] = [];
  if (Array.isArray(body.plan)) {
    for (const raw of (body.plan as unknown[]).slice(0, 8)) {
      const st = raw as { title?: unknown; detail?: unknown; files?: unknown };
      const title = typeof st?.title === "string" ? st.title.trim().slice(0, 80) : "";
      if (!title) continue;
      planSteps.push({
        title,
        detail: typeof st?.detail === "string" ? st.detail.trim().slice(0, 240) : "",
        files: Array.isArray(st?.files)
          ? (st.files as unknown[])
              .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
              .slice(0, 6)
          : [],
      });
    }
  }

  if (!instruction) {
    return NextResponse.json(
      { success: false, error: "An instruction is required." },
      { status: 400 }
    );
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select(`id, name, model_config, wordpress_sites ( site_url, bridge_token_encrypted )`)
    .eq("id", context.projectId)
    .single();

  if (projectError || !project) {
    return NextResponse.json(
      { success: false, error: "Project not found." },
      { status: 404 }
    );
  }

  const wordpressSites = project.wordpress_sites as
    | { site_url: string | null; bridge_token_encrypted: string | null }[]
    | { site_url: string | null; bridge_token_encrypted: string | null }
    | null;
  const site = Array.isArray(wordpressSites) ? wordpressSites[0] : wordpressSites;

  if (!site || !site.site_url || !site.bridge_token_encrypted) {
    return NextResponse.json(
      { success: false, error: "WordPress connection is missing." },
      { status: 400 }
    );
  }

  const bridgeToken = decryptSecret(site.bridge_token_encrypted);
  const siteUrl = site.site_url;

  const editModel = pickModel((project as { model_config?: unknown }).model_config, "edit");
  try {
    // Always hand the model the real theme structure up front — it never
    // guesses paths and saves a tool round.
    let structureBlock = "";
    try {
      const structure = await listProjectFiles(siteUrl, bridgeToken, "theme");
      structureBlock = `\n\nTheme structure (current, read-only):\n${JSON.stringify(structure)}`;
    } catch {
      structureBlock = "";
    }

    const inspected: string[] = [];
    const startedAt = Date.now();

    const result = await runToolLoop({
      model: editModel,
      system: INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content:
            `Instruction: ${instruction}` +
            (planSteps.length
              ? `\n\nPLAN (your work queue — execute the steps in this order, one by one):\n` +
                planSteps
                  .map(
                    (st, i) =>
                      `${i + 1}. ${st.title}${st.detail ? " — " + st.detail : ""}${
                        st.files.length ? ` (files: ${st.files.join(", ")})` : ""
                      }`
                  )
                  .join("\n")
              : "") +
            structureBlock,
        },
      ],
      tools,
      maxTokens: 16000,
      maxRounds: 10,
      handler: async (name, args) => {
        try {
          if (name === "list_project_files") {
            return await listProjectFiles(siteUrl, bridgeToken, "theme");
          }
          if (name === "read_project_files") {
            const paths = validatePaths(args.paths);
            for (const pth of paths) {
              if (!inspected.includes(pth)) inspected.push(pth);
            }
            return await readProjectFiles(siteUrl, bridgeToken, "theme", paths);
          }
          return { error: `Unknown tool: ${name}` };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Tool failed." };
        }
      },
    });


    if (result.exhausted) {
      void logUsage(context.projectId, "edit", editModel, result.usage, {
        instruction: instruction.slice(0, 400),
        inspected: inspected.slice(0, 12),
        toolCalls: result.toolCalls,
        durationMs: Date.now() - startedAt,
        exhausted: true,
      });
      return NextResponse.json(
        { success: false, usage: result.usage, error: "The edit took too many steps. Try a more specific instruction." },
        { status: 502 }
      );
    }

    const parsed = parseOutput(result.text);
    void logUsage(context.projectId, "edit", editModel, result.usage, {
      instruction: instruction.slice(0, 400),
      planSteps: planSteps.map((st) => st.title),
      inspected: inspected.slice(0, 12),
      changed: parsed.files.map((f) => f.path).slice(0, 12),
      summary: parsed.summary.slice(0, 300),
      toolCalls: result.toolCalls,
      durationMs: Date.now() - startedAt,
      exhausted: result.exhausted,
    });
    if (parsed.files.length === 0) {
      return NextResponse.json(
        { success: false, usage: result.usage, error: "The editor could not produce a change for that. Try rephrasing." },
        { status: 502 }
      );
    }
    return NextResponse.json({
      success: true,
      summary: parsed.summary,
      files: parsed.files,
      inspected: inspected.slice(0, 12),
      usage: result.usage,
    });
  } catch (error) {
    console.error("edit-theme error:", error);
    return NextResponse.json(
      { success: false, error: "The theme editor could not be reached. Try again." },
      { status: 502 }
    );
  }
}
