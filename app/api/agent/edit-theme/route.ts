import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { pickModel } from "@/lib/ai/resolve";
import { runToolLoop, type ToolDef } from "@/lib/ai/toolloop";
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

const INSTRUCTIONS = `Edit the active classic PHP WordPress theme per the instruction.
1. Inspect first: list_project_files, then read the files you'll change + assets/css/main.css.
2. Fewest files possible; reuse existing classes and tokens; responsive; COMPLETE file contents, never diffs.
3. No JS libraries. No PHP that executes code or touches filesystem/network (eval, exec, file_get_contents, fopen, curl_exec, wp_remote_*, base64_decode, call_user_func, preg_replace_callback...).
Final reply: no tool calls, first characters "SUMMARY:", then FILE blocks, no fences:
SUMMARY: <one sentence>
===WPAB_FILE:<path>===
<complete new contents>
===WPAB_END===`;

const tools: ToolDef[] = [
  {
    name: "list_project_files",
    description:
      "List readable files in the active theme so you never guess paths. Call this first.",
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

  try {
    const result = await runToolLoop({
      model: pickModel((project as { model_config?: unknown }).model_config, "edit"),
      system: INSTRUCTIONS,
      messages: [{ role: "user", content: `Instruction: ${instruction}` }],
      tools,
      maxTokens: 16000,
      maxRounds: 6,
      handler: async (name, args) => {
        try {
          if (name === "list_project_files") {
            return await listProjectFiles(siteUrl, bridgeToken, "theme");
          }
          if (name === "read_project_files") {
            return await readProjectFiles(siteUrl, bridgeToken, "theme", validatePaths(args.paths));
          }
          return { error: `Unknown tool: ${name}` };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Tool failed." };
        }
      },
    });

    if (result.exhausted) {
      return NextResponse.json(
        { success: false, usage: result.usage, error: "The edit took too many steps. Try a more specific instruction." },
        { status: 502 }
      );
    }

    const parsed = parseOutput(result.text);
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
