import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { SMART_MODEL } from "@/lib/ai/models";
import { listProjectFiles, readProjectFiles } from "@/lib/wordpress/bridge";

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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INSTRUCTIONS = `You are a senior WordPress theme QA engineer reviewing a JUST-GENERATED, active CLASSIC PHP theme for CRITICAL, high-impact defects only. Inspect the REAL files with the tools (list_project_files first, then read the files you need) — never guess file contents or paths.

Hunt for these, in priority order:
1. INVISIBLE / HIDDEN CONTENT: reveal or animation CSS that hides elements (opacity:0, visibility:hidden, display:none, or an off-screen transform) where the JS never clears the hidden state — e.g. CSS reveals via a .is-revealed class but main.js animates inline (gsap.fromTo on opacity) instead of adding the class, or visibility:hidden is set and never removed. In a normal browser (with the libraries loaded) all content MUST end up visible.
2. SELECTOR / ATTRIBUTE MISMATCHES across files: header/footer/section markup using class or data-* names that main.css does not style or main.js does not target (site header, nav, mobile menu toggle, sliders, animated backgrounds, counters, tabs, accordions). The mobile hamburger menu especially must actually open.
3. JS <-> LIBRARY MISMATCHES: main.js using a library (Typed, Swiper, GLightbox, tsParticles, VanillaTilt, gsap/ScrollTrigger) that functions.php does NOT enqueue, or a data-* effect in the markup whose library is missing. Fix by enqueuing the missing cdnjs library in functions.php (exact version URL, correct footer + deps) OR removing the dead effect — prefer enqueuing when a section clearly wants the effect.
4. PHP that would FATAL or emit notices: undefined function, wrong get_template_part path, a template part referenced by a template but not present, obviously wrong/unescaped WP calls.
5. LAYOUT BREAKAGE: horizontal overflow, collapsed/empty containers, unreadable contrast, a hero or section that renders with no visible content.
6. MISSING ENQUEUE of assets/css/main.css, assets/js/main.js or the Google fonts.

Rules:
- Only fix REAL, critical problems. Do NOT restyle, redesign or "improve" things that already work. Make the SMALLEST change that fixes the defect (correct the JS selector, add the missing enqueue, remove the broken hidden state, fix the PHP). Keep the theme's existing design tokens, classes and conventions.
- Return the COMPLETE new contents of EVERY file you change — not a diff, not a fragment.
- If you find NO critical problems, return NO file blocks at all.

Security — NEVER use any of these in PHP: eval, assert, create_function, shell_exec, exec, system, passthru, proc_open, popen, base64_decode, gzinflate, call_user_func, preg_replace_callback, file_get_contents, file_put_contents, fopen, fwrite, unlink, curl_exec, wp_remote_get, wp_remote_post, or backtick shell execution. (filemtime() and enqueuing remote cdnjs CSS/JS via wp_enqueue_style/script are fine.)

When done inspecting, respond with NO tool calls and output EXACTLY:
SUMMARY: <one short sentence: what you fixed, or "No critical issues found.">
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

  const input = focus
    ? `Review the active generated theme for CRITICAL defects. Pay special attention to: ${focus}`
    : `Review the active generated theme for CRITICAL defects and return fixes for any you find.`;

  try {
    let response = await openai.responses.create({
      model: SMART_MODEL,
      instructions: INSTRUCTIONS,
      input,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: true,
      max_output_tokens: 24000,
    });

    for (let round = 0; round < 6; round++) {
      const calls = response.output.filter((item) => item.type === "function_call");

      if (calls.length === 0) {
        const parsed = parseOutput(response.output_text || "");
        return NextResponse.json({
          success: true,
          summary: parsed.summary,
          files: parsed.files,
          issuesFound: parsed.files.length,
        });
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
        max_output_tokens: 24000,
      });
    }

    // Ran out of rounds without a final answer — treat as "nothing applied".
    return NextResponse.json({
      success: true,
      summary: "Review did not converge; no changes applied.",
      files: [],
      issuesFound: 0,
    });
  } catch (error) {
    console.error("review-theme error:", error);
    return NextResponse.json(
      { success: false, error: "The theme reviewer could not be reached." },
      { status: 502 }
    );
  }
}
