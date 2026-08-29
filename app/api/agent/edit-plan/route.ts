import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { pickModel } from "@/lib/ai/resolve";
import { generateText } from "@/lib/ai/provider";
import { logUsage } from "@/lib/ai/usage";
import { listProjectFiles } from "@/lib/wordpress/bridge";

export const maxDuration = 120;

/**
 * WordPress -> SaaS : PLAN a theme edit before applying it.
 *
 * The cheap model turns the user's instruction + the real theme structure into
 * a short numbered execution plan. The wizard shows it to the user, then the
 * edit stage executes the steps as its work queue.
 */

const INSTRUCTIONS = `You are the planning step of a WordPress theme editor. Given the user's change request and the theme's file list, produce a short execution plan that another model will follow step by step. Answer with ONLY this JSON (no markdown, no text outside it):
{"summary":"one sentence of what will be done","steps":[{"title":"3-6 word action","detail":"one sentence: exactly what to change and where","files":["relative/path.php"]}]}
Rules: 2-5 steps; each step is one concrete change; reference only files that exist in the provided structure; the last step must verify consistency (styles reuse the theme's tokens, layout stays responsive). Plain user-facing language in title and detail.`;

type Json = Record<string, unknown>;

export type EditPlanStep = { title: string; detail: string; files: string[] };

function parsePlan(text: string): { summary: string; steps: EditPlanStep[] } | null {
  try {
    let txt = text.trim();
    const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) txt = fence[1].trim();
    const start = txt.indexOf("{");
    const end = txt.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(txt.slice(start, end + 1)) as {
      summary?: unknown;
      steps?: unknown;
    };
    if (!Array.isArray(parsed.steps) || !parsed.steps.length) return null;
    const steps: EditPlanStep[] = [];
    for (const raw of parsed.steps.slice(0, 6)) {
      const st = raw as { title?: unknown; detail?: unknown; files?: unknown };
      const title = typeof st.title === "string" ? st.title.trim().slice(0, 80) : "";
      const detail = typeof st.detail === "string" ? st.detail.trim().slice(0, 240) : "";
      if (!title) continue;
      const files = Array.isArray(st.files)
        ? st.files
            .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
            .slice(0, 6)
        : [];
      steps.push({ title, detail, files });
    }
    if (!steps.length) return null;
    return {
      summary:
        typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 240) : "",
      steps,
    };
  } catch {
    return null;
  }
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
    .select(`id, model_config, wordpress_sites ( site_url, bridge_token_encrypted )`)
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

  let structure: unknown = null;
  try {
    structure = await listProjectFiles(
      site.site_url,
      decryptSecret(site.bridge_token_encrypted),
      "theme"
    );
  } catch {
    structure = null;
  }

  const model = pickModel((project as { model_config?: unknown }).model_config, "cheap");

  try {
    const gen = await generateText({
      model,
      system: INSTRUCTIONS,
      maxTokens: 1500,
      input:
        `Change request: ${instruction}` +
        (structure ? `\n\nTheme structure:\n${JSON.stringify(structure)}` : ""),
    });

    const plan = parsePlan(gen.text);

    void logUsage(context.projectId, "editplan", model, gen.usage, {
      instruction: instruction.slice(0, 400),
      steps: plan ? plan.steps.map((s) => s.title) : null,
    });

    if (!plan) {
      return NextResponse.json(
        { success: false, usage: gen.usage, error: "Could not produce a plan." },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, plan, usage: gen.usage });
  } catch (error) {
    console.error("edit-plan error:", error);
    return NextResponse.json(
      { success: false, error: "The planner could not be reached." },
      { status: 502 }
    );
  }
}
