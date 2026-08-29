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

const INSTRUCTIONS = `You are a senior WordPress theme developer editing a MODERN, DEPENDENCY-FREE classic PHP theme in place, from a plain-language instruction. Your change must look like it always belonged — match the theme's existing design system, tokens and art-direction concept.

How to work:
1. First inspect the real theme with the tools (list_project_files, then read_project_files) so you edit the ACTUAL current code — never guess. Read the file(s) you'll change PLUS assets/css/main.css for the design tokens and conventions.
2. Change the SMALLEST set of files that satisfies the request. Reuse the theme's existing classes, design tokens (CSS custom properties in main.css), section conventions and the concept already established. Keep everything responsive, accessible and consistent.
3. You may edit existing files and create new ones (e.g. a new template-parts/section-*.php wired into the page). Keep the classic-theme conventions: get_header()/get_footer(), get_template_part('template-parts/section','<slug>'), the loop, esc_* output, enqueue via functions.php.
4. Return the COMPLETE new contents of each changed file — not a diff, not a fragment.

DEPENDENCY-FREE — the theme uses NO external JS libraries or frameworks. Do NOT add GSAP, Swiper, tsParticles, GLightbox, Typed, AOS, Alpine, jQuery or any CDN script. (Google Fonts is the only allowed external stylesheet; real <img> placeholder photos are fine.) Any motion is modern CSS + small vanilla JS in assets/js/main.js.

FOLLOW THE THEME CONTRACT so nothing breaks:
- Scroll reveals: elements use data-reveal (up|left|right|scale) / data-reveal-group; CSS hides them under html.has-motion with opacity+transform ONLY (never visibility/display) and main.js reveals by adding .is-revealed via IntersectionObserver. Never hide content in a way the JS won't clear.
- Header/nav: keep the existing hooks (.site-header[data-header], .site-nav[data-nav], .site-header__toggle[data-nav-toggle], .site-nav__menu, .is-scrolled, .is-open) — main.js targets these; do not rename them.
- Sections stay <section class="section section-<slug>"> with a matching .section-<slug> CSS block; animated backgrounds use <div class="section-bg" data-bg="mesh|blobs|aurora|grid">.
- Use the design tokens (colours, --grad, --space-*, --radius, --shadow-*), not hardcoded values.

Security — NEVER use any of these in PHP: eval, assert, create_function, shell_exec, exec, system, passthru, proc_open, popen, base64_decode, gzinflate, call_user_func, preg_replace_callback, file_get_contents, file_put_contents, fopen, fwrite, unlink, curl_exec, wp_remote_get, wp_remote_post, or backtick shell execution. (filemtime() and enqueuing the Google Fonts stylesheet are fine; do NOT enqueue any JS library.)

When you are done inspecting and ready to deliver, respond with NO tool calls and output EXACTLY this, and nothing else:
SUMMARY: <one short sentence describing the change>
===WPAB_FILE:<path>===
<the complete raw new file contents>
===WPAB_END===
(repeat the FILE/END block for every changed file; do not use code fences)
STRICT: that final reply STARTS with "SUMMARY:" as its very first characters — no preamble, no explanation before it, nothing after the last ===WPAB_END===.`;

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
