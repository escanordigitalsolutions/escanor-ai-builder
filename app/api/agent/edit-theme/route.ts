import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { SMART_MODEL } from "@/lib/ai/models";
import { listProjectFiles, readProjectFiles } from "@/lib/wordpress/bridge";

/**
 * WordPress -> SaaS : edit the active generated theme.
 *
 * Given a plain-language instruction, this inspects the theme's real files
 * (read-only, over the bridge), decides the minimal set of files to change and
 * returns their complete new contents. The WordPress side writes them via the
 * WPAB_Theme_Writer::update() path (only the generated theme, validated, with a
 * one-level undo). Nothing is written here.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INSTRUCTIONS = `You are a senior WordPress theme developer editing a MODERN, professional CLASSIC PHP theme in place, from a plain-language instruction.

How to work:
1. First inspect the real theme using the tools (list_project_files, then read_project_files) so you edit the ACTUAL current code — never guess file contents or paths.
2. Change the SMALLEST set of files that satisfies the request. Reuse the theme's existing classes, design tokens (CSS custom properties in assets/css/main.css) and conventions. Keep everything responsive, accessible and consistent with the current design.
3. You may edit existing files and create new ones (e.g. a new template-parts/section-*.php, and wire it into the relevant page template). Keep the classic-theme conventions: get_header()/get_footer(), get_template_part('template-parts/section','<slug>'), the loop, esc_* output, enqueue via functions.php.
4. Return the COMPLETE new contents of each changed file — not a diff, not a fragment.

Security — NEVER use any of these in PHP: eval, assert, create_function, shell_exec, exec, system, passthru, proc_open, popen, base64_decode, gzinflate, call_user_func, preg_replace_callback, file_get_contents, file_put_contents, fopen, fwrite, unlink, curl_exec, wp_remote_get, wp_remote_post, or backtick shell execution. (Enqueuing a remote CSS/JS URL with wp_enqueue_style/script is fine.)

When you are done inspecting and ready to deliver, respond with NO tool calls and output EXACTLY this, and nothing else:
SUMMARY: <one short sentence describing the change>
===WPAB_FILE:<path>===
<the complete raw new file contents>
===WPAB_END===
(repeat the FILE/END block for every changed file; do not use code fences)`;

const tools = [
  {
    type: "function" as const,
    name: "list_project_files",
    description:
      "List readable files in the active theme so you never guess paths. Call this first.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "read_project_files",
    description:
      "Read the full contents of up to 8 theme files by their relative paths (from list_project_files).",
    strict: true,
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
    .select(`id, name, wordpress_sites ( site_url, bridge_token_encrypted )`)
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
    let response = await openai.responses.create({
      model: SMART_MODEL,
      instructions: INSTRUCTIONS,
      input: `Instruction: ${instruction}`,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: true,
      max_output_tokens: 16000,
    });

    for (let round = 0; round < 6; round++) {
      const calls = response.output.filter((item) => item.type === "function_call");

      if (calls.length === 0) {
        const parsed = parseOutput(response.output_text || "");
        if (parsed.files.length === 0) {
          return NextResponse.json(
            { success: false, error: "The editor could not produce a change for that. Try rephrasing." },
            { status: 502 }
          );
        }
        return NextResponse.json({ success: true, summary: parsed.summary, files: parsed.files });
      }

      const outputs = await Promise.all(
        calls.map(async (call) => {
          let result: unknown;
          try {
            const args = JSON.parse(call.arguments || "{}");
            if (call.name === "list_project_files") {
              result = await listProjectFiles(siteUrl, bridgeToken, "theme");
            } else if (call.name === "read_project_files") {
              result = await readProjectFiles(siteUrl, bridgeToken, "theme", validatePaths(args.paths));
            } else {
              result = { error: `Unknown tool: ${call.name}` };
            }
          } catch (e) {
            result = { error: e instanceof Error ? e.message : "Tool failed." };
          }
          return {
            type: "function_call_output" as const,
            call_id: call.call_id,
            output: JSON.stringify(result),
          };
        })
      );

      response = await openai.responses.create({
        model: SMART_MODEL,
        instructions: INSTRUCTIONS,
        previous_response_id: response.id,
        input: outputs,
        tools,
        tool_choice: "auto",
        parallel_tool_calls: true,
        max_output_tokens: 16000,
      });
    }

    return NextResponse.json(
      { success: false, error: "The edit took too many steps. Try a more specific instruction." },
      { status: 502 }
    );
  } catch (error) {
    console.error("edit-theme error:", error);
    return NextResponse.json(
      { success: false, error: "The theme editor could not be reached. Try again." },
      { status: 502 }
    );
  }
}
