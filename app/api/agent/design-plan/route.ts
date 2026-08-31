import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { pickModel } from "@/lib/ai/resolve";
import { runToolLoop, type ToolDef } from "@/lib/ai/toolloop";
import {
  createProjectFileReader,
  parseProjectSnapshot,
} from "@/lib/wordpress/project-files";

// Model calls can run long; don't let Vercel's plan-default duration kill the
// function mid-generation.
export const maxDuration = 300;


/**
 * WordPress -> SaaS : STAGED design revision — the critique step.
 *
 * Runs after the theme is written and the correctness check has passed. It
 * inspects the real theme against its design concept and returns a small
 * punch-list of the highest-impact DESIGN elevations (which file to change and
 * a concrete art-direction instruction). The WordPress side then applies each
 * target one at a time via the existing edit-theme path — so every call is
 * small and timeout-safe, and the user sees per-file progress. Nothing is
 * written here.
 */

const INSTRUCTIONS = `Art-direct this just-generated WordPress theme toward a bespoke look. Inspect with the tools (main.css, front-page.php, section template-parts), then name at most 3 concrete changes with the biggest visual impact — bolder hero, more dramatic type scale, a more distinctive section layout, braver use of imagery or whitespace. CSS + vanilla JS only, responsive.
Final reply: ONLY JSON, { first, } last:
{ "verdict": "one sentence", "targets": [ { "path": "...", "instruction": "..." } ] }`;

const tools: ToolDef[] = [
  {
    name: "list_project_files",
    description: "List readable files in the active theme so you never guess paths. Call this first.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "read_project_files",
    description: "Read the full contents of up to 8 theme files by their relative paths.",
    parameters: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["paths"],
      additionalProperties: false,
    },
  },
];

type Json = Record<string, unknown>;

function validatePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .slice(0, 8);
}

function extractJson(text: string): Json | null {
  let t = (text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    t = fence[1].trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Json) : null;
  } catch {
    return null;
  }
}

function normalizeTargets(value: unknown): { path: string; instruction: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: { path: string; instruction: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const path = typeof (item as Json).path === "string" ? ((item as Json).path as string).trim() : "";
    const instruction =
      typeof (item as Json).instruction === "string" ? ((item as Json).instruction as string).trim() : "";
    if (path && instruction) {
      out.push({ path, instruction: instruction.slice(0, 1200) });
    }
    if (out.length >= 6) {
      break;
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  const supabase = createServiceClient();

  let body: Json = {};
  try {
    body = (await request.json()) as Json;
  } catch {
    body = {};
  }

  const concept = body.concept ?? (body.blueprint && (body.blueprint as Json).concept) ?? null;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select(`id, name, model_config, wordpress_sites ( site_url, bridge_token_encrypted )`)
    .eq("id", context.projectId)
    .single();

  if (projectError || !project) {
    return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });
  }

  const wordpressSites = project.wordpress_sites as
    | { site_url: string | null; bridge_token_encrypted: string | null }[]
    | { site_url: string | null; bridge_token_encrypted: string | null }
    | null;
  const site = Array.isArray(wordpressSites) ? wordpressSites[0] : wordpressSites;

  if (!site || !site.site_url || !site.bridge_token_encrypted) {
    return NextResponse.json({ success: false, error: "WordPress connection is missing." }, { status: 400 });
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


  const input = concept
    ? `The theme's intended design concept:\n${JSON.stringify(concept)}\n\nReview the active theme and return the highest-impact design elevations.`
    : `Review the active theme (infer its intended concept from the code) and return the highest-impact design elevations.`;

  try {
    const result = await runToolLoop({
      model: pickModel((project as { model_config?: unknown }).model_config, "edit"),
      system: INSTRUCTIONS,
      messages: [{ role: "user", content: input }],
      tools,
      maxTokens: 4000,
      maxRounds: 5,
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

    if (result.exhausted) {
      return NextResponse.json({ success: true, verdict: "", targets: [], usage: result.usage });
    }

    const parsed = extractJson(result.text);
    const targets = normalizeTargets(parsed ? parsed.targets : []);
    const verdict = parsed && typeof parsed.verdict === "string" ? parsed.verdict : "";
    return NextResponse.json({ success: true, verdict, targets, usage: result.usage });
  } catch (error) {
    console.error("design-plan error:", error);
    return NextResponse.json({ success: false, error: "The design reviewer could not be reached." }, { status: 502 });
  }
}
