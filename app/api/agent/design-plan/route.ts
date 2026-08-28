import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { SMART_MODEL } from "@/lib/ai/models";
import { listProjectFiles, readProjectFiles } from "@/lib/wordpress/bridge";

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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INSTRUCTIONS = `You are an award-winning art director reviewing a JUST-GENERATED WordPress theme against its intended design CONCEPT. Your job is to make it more DISTINCTIVE and closer to Awwwards-level craft — NOT to fix bugs (a separate pass handles correctness).

Inspect the real theme with the tools (list_project_files first, then read the files that carry the design — assets/css/main.css, header.php, footer.php, front-page.php and the template-parts/section-*.php). Judge it honestly against the concept and against these questions:
- Distinctiveness: does it look like a bespoke site, or a generic template? Would it stand out?
- Concept adherence: does it actually express the archetype, mood and SIGNATURE from the concept?
- Typography: is the scale bold and the hierarchy strong, or is everything the same safe size?
- Sectional variety: do adjacent sections genuinely differ (background, layout, rhythm), or do they blur together?
- Imagery: are photos used as a design element (full-bleed, treated, confident), or just small boxes?
- Layout ambition: is there asymmetry, full-bleed, overlap, negative space — or is everything centered and boxed?

The theme is intentionally DEPENDENCY-FREE (vanilla JS + modern CSS only, no libraries). Never propose adding GSAP, Swiper, tsParticles, GLightbox or any CDN library — achieve every effect with CSS and small vanilla JS (IntersectionObserver, scroll-snap, requestAnimationFrame).

Return the 3-6 HIGHEST-IMPACT changes that would most elevate the design. For each, name the exact file and give a CONCRETE, art-directed instruction (what to change and how, in the language of the concept) — bold but still responsive, accessible and consistent with the theme's design tokens. Order most impactful first. Prefer changes to section template-parts and main.css. Do not propose more than 6.

Respond with ONLY valid JSON, no markdown, no commentary:
{ "verdict": "one short sentence on how generic vs distinctive it is now", "targets": [ { "path": "template-parts/section-hero.php", "instruction": "concrete art-directed change" } ] }`;

const tools = [
  {
    type: "function" as const,
    name: "list_project_files",
    description: "List readable files in the active theme so you never guess paths. Call this first.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function" as const,
    name: "read_project_files",
    description: "Read the full contents of up to 8 theme files by their relative paths.",
    strict: true,
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
    .select(`id, name, wordpress_sites ( site_url, bridge_token_encrypted )`)
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

  const input = concept
    ? `The theme's intended design concept:\n${JSON.stringify(concept)}\n\nReview the active theme and return the highest-impact design elevations.`
    : `Review the active theme (infer its intended concept from the code) and return the highest-impact design elevations.`;

  try {
    let response = await openai.responses.create({
      model: SMART_MODEL,
      instructions: INSTRUCTIONS,
      input,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: true,
      max_output_tokens: 4000,
    });

    for (let round = 0; round < 5; round++) {
      const calls = response.output.filter((item) => item.type === "function_call");

      if (calls.length === 0) {
        const parsed = extractJson(response.output_text || "");
        const targets = normalizeTargets(parsed ? parsed.targets : []);
        const verdict = parsed && typeof parsed.verdict === "string" ? parsed.verdict : "";
        return NextResponse.json({ success: true, verdict, targets });
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
        max_output_tokens: 4000,
      });
    }

    return NextResponse.json({ success: true, verdict: "", targets: [] });
  } catch (error) {
    console.error("design-plan error:", error);
    return NextResponse.json({ success: false, error: "The design reviewer could not be reached." }, { status: 502 });
  }
}
