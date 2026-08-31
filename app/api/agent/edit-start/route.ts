import { NextRequest, NextResponse, after } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { describeError } from "@/lib/debug";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { pickModel } from "@/lib/ai/resolve";
import { runToolLoop, type ToolDef } from "@/lib/ai/toolloop";
import { recordUsage } from "@/lib/ai/usage";
import {
  createProjectFileReader,
  parseProjectSnapshot,
} from "@/lib/wordpress/project-files";

export const maxDuration = 300;

/**
 * WordPress -> SaaS : START a theme edit as a background job.
 *
 * Same brain as agent/edit-theme, but async: a job row is created, the edit
 * loop runs in after(), and the wizard polls agent/job-status — so no request
 * in the browser -> WP -> Vercel chain stays open long enough for a hosting
 * proxy to kill it. The RESULT carries the new file contents; WordPress
 * applies them via its own /editor/edit-apply endpoint.
 */

const INSTRUCTIONS = `Edit the active classic PHP WordPress theme exactly as requested.

Rules:
1. Read every file before changing it. Start with the files in the plan, then read only direct dependencies if required.
2. Make the smallest complete change. Do not redesign, rewrite, reformat or alter unrelated content.
3. Preserve existing structure, classes, tokens and responsive behavior where possible.
4. Return only changed files, each with its complete contents. Never return diffs.
5. Do not create references to missing files or add external JS libraries.
6. Do not use unsafe PHP, filesystem access, network calls or dynamic code execution.
7. If the request cannot be completed safely from the available files, return no file blocks and explain the blocker in SUMMARY.
8. Copy is sacred: never change visible text unless the request explicitly asks for a text change — and then use the EXACT wording given in the request, character for character. Never paraphrase, shorten or invent copy.

Final format:
SUMMARY: <what changed and where>
===WPAB_FILE:<relative-path>===
<complete contents>
===WPAB_END===`;

const tools: ToolDef[] = [
  {
    name: "list_project_files",
    description:
      "Re-list the readable theme files (the structure is already in the message; call this only if it seems stale).",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "read_project_files",
    description:
      "Read the full contents of up to 8 theme files by their relative paths (from list_project_files).",
    parameters: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["paths"],
      additionalProperties: false,
    },
  },
];

type Json = Record<string, unknown>;

function parseOutput(text: string): { summary: string; files: { path: string; contents: string }[] } {
  const files: { path: string; contents: string }[] = [];
  const parts = text.split(/===\s*WPAB_FILE\s*:/);
  for (let i = 1; i < parts.length; i++) {
    const m = parts[i].match(/^\s*([^\n=]+?)\s*===\s*\r?\n?([\s\S]*)$/);
    if (!m) continue;
    const path = m[1].trim().replace(/^`+|`+$/g, "");
    let contents = m[2].replace(/^﻿/, "");
    contents = contents.replace(/\n?===\s*WPAB_END\s*===[\s\S]*$/, "");
    // Cheap models sometimes wrap file contents in markdown fences — strip
    // them so ```php never ends up inside a real theme file.
    contents = contents
      .replace(/^\s*```[a-zA-Z]*\s*\r?\n/, "")
      .replace(/\r?\n```\s*$/, "");
    if (path) {
      files.push({ path, contents: contents.replace(/\s+$/, "") + "\n" });
    }
  }
  const sm = text.match(/SUMMARY:\s*(.+)/);
  return { summary: sm ? sm[1].trim() : "Updated the theme.", files };
}

function validatePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .slice(0, 8);
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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select(`id, model_config, wordpress_sites ( site_url, bridge_token_encrypted )`)
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

  const modelConfig = (project as { model_config?: unknown }).model_config;
  const projectId = context.projectId;

  const { data: job, error: jobError } = await supabase
    .from("ai_jobs")
    .insert({ project_id: projectId, kind: "edit", status: "running" })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("edit-start job insert error:", jobError);
    return NextResponse.json(
      { success: false, error: "Could not start the edit job." },
      { status: 500 }
    );
  }

  const jobId = job.id as string;

  after(async () => {
    const db = createServiceClient();
    const setProgress = async (note: string) => {
      await db
        .from("ai_jobs")
        .update({
          result: { progress: { stage: "edit", note } },
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .then(() => {}, () => {});
    };

    try {
      await setProgress("Reading the theme structure…");
      let structureBlock = "";
      try {
        const structure = await projectFiles.list("theme");
        structureBlock = `\n\nTheme structure (current, read-only):\n${JSON.stringify(structure)}`;
      } catch {
        structureBlock = "";
      }

      const editModel = pickModel(modelConfig, "edit");
      const inspected: string[] = [];
      const startedAt = Date.now();
      await setProgress(
        planSteps.length
          ? `Working the plan — ${planSteps.length} steps…`
          : "Understanding the change…"
      );

      const result = await runToolLoop({
        model: editModel,
        system: INSTRUCTIONS,
        messages: [
          {
            role: "user",
            content:
              (themeName ? `ACTIVE THEME: ${themeName}\n\n` : "") +
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
              void setProgress(`Reading ${paths.length} file${paths.length === 1 ? "" : "s"}…`);
              return await projectFiles.read("theme", paths);
            }
            return { error: `Unknown tool: ${name}` };
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Tool failed." };
          }
        },
      });

      const parsed = parseOutput(result.text);

      await recordUsage(projectId, "edit", editModel, result.usage, {
        instruction: instruction.slice(0, 400),
        planSteps: planSteps.map((st) => st.title),
        inspected: inspected.slice(0, 12),
        changed: parsed.files.map((f) => f.path).slice(0, 12),
        summary: parsed.summary.slice(0, 300),
        toolCalls: result.toolCalls,
        durationMs: Date.now() - startedAt,
        exhausted: result.exhausted,
        async: true,
      }, jobId);

      if (result.exhausted || parsed.files.length === 0) {
        const blocker =
          parsed.summary && parsed.summary !== "Updated the theme."
            ? parsed.summary.slice(0, 400)
            : "The editor could not produce a change for that. Try rephrasing.";
        await db
          .from("ai_jobs")
          .update({
            status: "error",
            error: result.exhausted
              ? "The edit took too many steps. Try a more specific instruction."
              : blocker,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        return;
      }

      await db
        .from("ai_jobs")
        .update({
          status: "done",
          result: {
            success: true,
            summary: parsed.summary,
            files: parsed.files,
            inspected: inspected.slice(0, 12),
            usage: result.usage,
          },
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    } catch (error) {
      console.error("edit job error:", error);
      await db
        .from("ai_jobs")
        .update({
          status: "error",
          error: describeError(error).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .then(() => {}, () => {});
    }
  });

  return NextResponse.json({ success: true, jobId });
}
