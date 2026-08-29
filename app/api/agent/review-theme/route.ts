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
 * WordPress -> SaaS : automated QA review of the just-generated theme.
 *
 * Runs AFTER the theme is written and activated. It inspects the real files
 * (read-only, over the bridge), hunts for CRITICAL defects (invisible content,
 * class/selector or JS<->library mismatches, PHP fatals, broken responsive) and
 * returns the COMPLETE fixed contents of only the files that need changing. The
 * WordPress side applies them via WPAB_Theme_Writer::update() (validated, undo).
 * Called once for the "check" pass and again for the "revise" pass. Nothing is
 * written here.
 */

const INSTRUCTIONS = `You are reviewing a just-generated, active classic PHP WordPress theme for CRITICAL defects only. Inspect the REAL files with the tools (list_project_files first, then read what you need) — never guess.

Fix ONLY these, with the smallest possible change:
1. Content that renders invisible or a section that renders empty — including a template calling get_template_part for a template-parts file that does NOT exist (create that file to match the theme's style).
2. A mobile menu that cannot open (toggle/nav selectors that main.js or main.css do not match).
3. PHP that would fatal (undefined function, wrong path).
4. Horizontal overflow or a clearly broken layout.
5. assets/css/main.css, assets/js/main.js or the Google Fonts URL not enqueued, or an external JS library enqueued (remove it).
Do NOT restyle or "improve" anything that already works. If nothing is critical, change nothing.

Return the COMPLETE new contents of every file you change. PHP must NEVER use: eval, assert, create_function, shell_exec, exec, system, passthru, proc_open, popen, base64_decode, gzinflate, call_user_func, preg_replace_callback, file_get_contents, file_put_contents, fopen, fwrite, unlink, curl_exec, wp_remote_get, wp_remote_post, or backticks.

When done, respond with NO tool calls. STRICT: the reply starts with "SUMMARY:" as its very first characters (one sentence — what you fixed, or "No critical issues found."), then one FILE block per changed file (none when nothing is critical), no code fences, nothing after the last block:
SUMMARY: <one short sentence>
===WPAB_FILE:<path>===
<the complete raw new file contents>
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
  return { summary: sm ? sm[1].trim() : "Reviewed the theme.", files };
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

  // Optional focus hint for the second (revise) pass.
  const focus = typeof body.focus === "string" ? body.focus.trim().slice(0, 500) : "";

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

  const input = focus
    ? `Review the active generated theme for CRITICAL defects. Pay special attention to: ${focus}`
    : `Review the active generated theme for CRITICAL defects and return fixes for any you find.`;

  try {
    const result = await runToolLoop({
      model: pickModel((project as { model_config?: unknown }).model_config, "review"),
      system: INSTRUCTIONS,
      messages: [{ role: "user", content: input }],
      tools,
      maxTokens: 24000,
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
      // Ran out of rounds without a final answer — treat as "nothing applied".
      return NextResponse.json({
        success: true,
        summary: "Review did not converge; no changes applied.",
        files: [],
        issuesFound: 0,
        usage: result.usage,
      });
    }

    const parsed = parseOutput(result.text);
    return NextResponse.json({
      success: true,
      summary: parsed.summary,
      files: parsed.files,
      issuesFound: parsed.files.length,
      usage: result.usage,
    });
  } catch (error) {
    console.error("review-theme error:", error);
    return NextResponse.json(
      { success: false, error: "The theme reviewer could not be reached." },
      { status: 502 }
    );
  }
}
