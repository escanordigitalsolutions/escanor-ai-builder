import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { pickModel } from "@/lib/ai/resolve";
import { generateText } from "@/lib/ai/provider";
import { logUsage } from "@/lib/ai/usage";
import {
  createProjectFileReader,
  parseProjectSnapshot,
} from "@/lib/wordpress/project-files";

export const maxDuration = 120;

/**
 * WordPress -> SaaS : PLAN a theme edit before applying it.
 *
 * The cheap model turns the user's instruction + the real theme structure into
 * a short numbered execution plan. The wizard shows it to the user, then the
 * edit stage executes the steps as its work queue.
 */

const INSTRUCTIONS = `Create a minimal execution plan for the requested WordPress theme change.

Return only:
{"summary":"...","steps":[{"title":"...","detail":"...","files":["..."]}]}

Rules:
- 1-4 steps.
- Use only existing files.
- Prefer the fewest files necessary.
- Do not add unrelated improvements.
- The final step verifies responsive layout and consistency; it may use an empty files array.
- If the selected element is provided, use it to identify the correct section.
- Include a text change only when the request explicitly asks for one; quote the exact new wording in the step detail.`;

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
  const selected =
    typeof body.selected === "string" ? body.selected.trim().slice(0, 600) : "";
  const themeName =
    typeof body.theme === "string" ? body.theme.trim().slice(0, 80) : "";
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
    structure = await createProjectFileReader({
      snapshot: parseProjectSnapshot((body as { project?: unknown }).project),
      siteUrl: site.site_url,
      token: decryptSecret(site.bridge_token_encrypted),
    }).list("theme");
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
        (themeName ? `Active theme: ${themeName}\n\n` : "") +
        `Change request: ${instruction}` +
        `\n\nSelected element: ${selected || "none"}` +
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
