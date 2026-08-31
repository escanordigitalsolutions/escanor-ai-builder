import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { pickModel } from "@/lib/ai/resolve";
import { runToolLoop, type ToolDef } from "@/lib/ai/toolloop";
import { logUsage } from "@/lib/ai/usage";
import {
  createProjectFileReader,
  parseProjectSnapshot,
} from "@/lib/wordpress/project-files";

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

const INSTRUCTIONS = `Review the active, just-generated classic PHP WordPress theme. Inspect real files with the tools. Fix ONLY critical defects, smallest change possible:
1. PHP that would fatal — especially a require/include of a file that does not exist (remove the require or create the file), an undefined function, a wrong path.
2. Invisible or empty content — including get_template_part() calling a missing file (create it in the theme's style).
3. Mobile menu that can't open (selector mismatch between header.php, main.css, main.js).
4. Horizontal overflow or clearly broken layout.
5. A theme stylesheet (base.css, header.css, footer.css, sections/*.css, inner.css or main.css), main.js or fonts not enqueued, an enqueued stylesheet whose file does not exist (create a minimal one), or a JS library enqueued (remove it).
6. page.php, page-*.php or single.php not rendering the_content() inside the loop — the real page copy lives in WordPress and MUST render there; hardcoded page copy in those templates is a defect (replace it with the loop + the_content(), keeping the designed page hero).
Never restyle what works. No PHP that executes code or touches filesystem/network (eval, exec, file_get_contents, fopen, curl_exec, wp_remote_*, base64_decode, call_user_func, preg_replace_callback...).
Final reply: no tool calls, first characters "SUMMARY:" (or "SUMMARY: No critical issues found."), then a FILE block per changed COMPLETE file, no fences:
SUMMARY: <one sentence>
===WPAB_FILE:<path>===
<contents>
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

  // The theme the plugin sent with this request. When it is there the agent
  // never calls back into the site, which is the whole point: most WordPress
  // installs are not reachable from Vercel.
  const projectFiles = createProjectFileReader({
    snapshot: parseProjectSnapshot((body as { project?: unknown }).project),
    siteUrl,
    token: bridgeToken,
  });


  const input = focus
    ? `Review the active generated theme for CRITICAL defects. Pay special attention to: ${focus}`
    : `Review the active generated theme for CRITICAL defects and return fixes for any you find.`;

  const reviewModel = pickModel((project as { model_config?: unknown }).model_config, "review");
  try {
    const result = await runToolLoop({
      model: reviewModel,
      system: INSTRUCTIONS,
      messages: [{ role: "user", content: input }],
      tools,
      maxTokens: 24000,
      maxRounds: 6,
      handler: async (name, args) => {
        try {
          if (name === "list_project_files") {
            return await projectFiles.list("theme");
          }
          if (name === "read_project_files") {
            return await projectFiles.read("theme", validatePaths(args.paths));
          }
          return { error: `Unknown tool: ${name}` };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Tool failed." };
        }
      },
    });

    void logUsage(context.projectId, "review", reviewModel, result.usage);

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
