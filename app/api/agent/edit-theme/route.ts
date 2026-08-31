import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { pickModel } from "@/lib/ai/resolve";
import { runToolLoop, type ToolDef } from "@/lib/ai/toolloop";
import { logUsage } from "@/lib/ai/usage";
import {
  applyAnchoredEdits,
  mergeEditedFiles,
  parseEditOutput,
} from "@/lib/agent/edit-output";
import {
  createProjectFileReader,
  parseProjectSnapshot,
} from "@/lib/wordpress/project-files";

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

const INSTRUCTIONS = `Edit the active classic PHP WordPress theme exactly as requested.

Rules:
1. Read every file before changing it. Start with the files in the plan, then read only direct dependencies if required.
2. Make the smallest complete change. Do not redesign, rewrite, reformat or alter unrelated content.
3. Preserve existing structure, classes, tokens and responsive behavior where possible.
4. Prefer an anchored edit (WPAB_EDIT) over rewriting a file. Return a whole file (WPAB_FILE) only when the change is structural — reordering or adding whole sections — or when most of the file changes.
5. An anchor's FIND text must be copied from the file character for character, including indentation, and must be long enough to appear exactly once. If it appears twice the edit is refused, so include a surrounding line to make it unique.
6. Never return a diff, and never put a markdown code fence inside a block.
7. Do not create references to missing files or add external JS libraries.
8. Do not use unsafe PHP, filesystem access, network calls or dynamic code execution.
9. If the request cannot be completed safely from the available files, return no blocks and explain the blocker in SUMMARY.
10. Copy is sacred: never change visible text unless the request explicitly asks for a text change — and then use the EXACT wording given in the request, character for character. Never paraphrase, shorten or invent copy.

Final format. Use one block per change, and as many blocks as the change needs:

SUMMARY: <what changed and where>

===WPAB_EDIT:<relative-path>===
---FIND---
<text exactly as it appears in the file>
---REPLACE---
<what it becomes>
===WPAB_END===

===WPAB_FILE:<relative-path>===
<complete contents>
===WPAB_END===`;

const tools: ToolDef[] = [
  {
    name: "list_project_files",
    description:
      "Re-list the readable theme files (the structure is already in the message; call this only if it seems stale).",
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
  const selected =
    typeof body.selected === "string" ? body.selected.trim().slice(0, 600) : "";

  // Optional execution plan from the edit-plan stage: a queue of steps the
  // model follows in order.
  const planSteps: { title: string; detail: string; files: string[] }[] = [];
  if (Array.isArray(body.plan)) {
    for (const raw of (body.plan as unknown[]).slice(0, 8)) {
      const st = raw as { title?: unknown; detail?: unknown; files?: unknown };
      const title = typeof st?.title === "string" ? st.title.trim().slice(0, 80) : "";
      if (!title) continue;
      planSteps.push({
        title,
        detail: typeof st?.detail === "string" ? st.detail.trim().slice(0, 240) : "",
        files: Array.isArray(st?.files)
          ? (st.files as unknown[])
              .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
              .slice(0, 6)
          : [],
      });
    }
  }

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

  // The theme the plugin sent with this request. When it is there the agent
  // never calls back into the site, which is the whole point: most WordPress
  // installs are not reachable from Vercel.
  const projectSnapshot = parseProjectSnapshot((body as { project?: unknown }).project);

  const projectFiles = createProjectFileReader({
    snapshot: projectSnapshot,
    siteUrl,
    token: bridgeToken,
  });


  const editModel = pickModel((project as { model_config?: unknown }).model_config, "edit");
  try {
    // Always hand the model the real theme structure up front — it never
    // guesses paths and saves a tool round.
    let structureBlock = "";
    try {
      const structure = await projectFiles.list("theme");
      structureBlock = `\n\nTheme structure (current, read-only):\n${JSON.stringify(structure)}`;
    } catch {
      structureBlock = "";
    }

    const inspected: string[] = [];
    const startedAt = Date.now();

    const result = await runToolLoop({
      model: editModel,
      system: INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content:
            `REQUEST:\n${instruction}` +
            `\n\nSELECTED ELEMENT:\n${selected || "none"}` +
            (planSteps.length
              ? `\n\nPLAN:\n` +
                planSteps
                  .map(
                    (st, i) =>
                      `${i + 1}. ${st.title}${st.detail ? " — " + st.detail : ""}${
                        st.files.length ? ` (files: ${st.files.join(", ")})` : ""
                      }`
                  )
                  .join("\n")
              : "") +
            structureBlock.replace("Theme structure (current, read-only):", "THEME FILES:"),
        },
      ],
      tools,
      maxTokens: 16000,
      maxRounds: 10,
      handler: async (name, args) => {
        try {
          if (name === "list_project_files") {
            return await projectFiles.list("theme");
          }
          if (name === "read_project_files") {
            const paths = validatePaths(args.paths);
            for (const pth of paths) {
              if (!inspected.includes(pth)) inspected.push(pth);
            }
            return await projectFiles.read("theme", paths);
          }
          return { error: `Unknown tool: ${name}` };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Tool failed." };
        }
      },
    });


    // A reply that stopped at the output ceiling ends mid-file. Writing it
    // would put half a stylesheet over a working one — and CSS, unlike PHP,
    // has no parse check downstream to catch it.
    if (result.truncated) {
      void logUsage(context.projectId, "edit", editModel, result.usage, {
        instruction: instruction.slice(0, 400),
        inspected: inspected.slice(0, 12),
        toolCalls: result.toolCalls,
        durationMs: Date.now() - startedAt,
        truncated: true,
      });
      return NextResponse.json(
        {
          success: false,
          usage: result.usage,
          error: "The edit was cut short before the file was finished, so nothing was written. Ask for a smaller change — one section or one file at a time.",
        },
        { status: 502 }
      );
    }

    if (result.exhausted) {
      void logUsage(context.projectId, "edit", editModel, result.usage, {
        instruction: instruction.slice(0, 400),
        inspected: inspected.slice(0, 12),
        toolCalls: result.toolCalls,
        durationMs: Date.now() - startedAt,
        exhausted: true,
      });
      return NextResponse.json(
        { success: false, usage: result.usage, error: "The edit took too many steps. Try a more specific instruction." },
        { status: 502 }
      );
    }

    // Anchored edits are applied here, against the file exactly as the site
    // sent it. Deliberately NOT through projectFiles.read(): that caps a file
    // at 60 000 characters for the model's benefit, and applying an anchor to
    // a capped file and writing the result back would truncate it on disk.
    const parsed = parseEditOutput(result.text);
    const anchorResult = applyAnchoredEdits(parsed.anchors, (path) =>
      projectSnapshot?.files.get(path)
    );
    const changedFiles = mergeEditedFiles(parsed.files, anchorResult.files);
    void logUsage(context.projectId, "edit", editModel, result.usage, {
      instruction: instruction.slice(0, 400),
      planSteps: planSteps.map((st) => st.title),
      inspected: inspected.slice(0, 12),
      changed: changedFiles.map((f) => f.path).slice(0, 12),
      anchors: parsed.anchors.length,
      anchorErrors: anchorResult.errors.slice(0, 6),
      summary: parsed.summary.slice(0, 300),
      toolCalls: result.toolCalls,
      durationMs: Date.now() - startedAt,
      exhausted: result.exhausted,
    });
    if (changedFiles.length === 0) {
      const blocker =
        anchorResult.errors.length > 0
          ? anchorResult.errors.join(" ").slice(0, 400)
          : parsed.summary && parsed.summary !== "Updated the theme."
            ? parsed.summary.slice(0, 400)
            : "The editor could not produce a change for that. Try rephrasing.";
      return NextResponse.json(
        { success: false, usage: result.usage, error: blocker },
        { status: 502 }
      );
    }
    return NextResponse.json({
      success: true,
      summary: parsed.summary,
      files: changedFiles,
      // An anchor that missed while others landed is worth saying out loud:
      // part of the request did not happen.
      notes: anchorResult.errors.slice(0, 6),
      inspected: inspected.slice(0, 12),
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
