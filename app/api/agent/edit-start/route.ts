import { NextRequest, NextResponse, after } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { describeError } from "@/lib/debug";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import { pickModel } from "@/lib/ai/resolve";
import { runToolLoop, type ToolDef } from "@/lib/ai/toolloop";
import { recordUsage } from "@/lib/ai/usage";
import {
  applyAnchoredEdits,
  mergeEditedFiles,
  parseEditOutput,
} from "@/lib/agent/edit-output";
import { reviewEdit } from "@/lib/agent/review-edit";
import {
  createProjectFileReader,
  parseProjectSnapshot,
  renderStructureForPrompt,
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

/**
 * How much of the plan's files we hand over up front.
 *
 * Generous, because the site already sent them and the alternative is a round
 * trip; bounded, because the reply still has to fit in the model's context
 * alongside whatever else it reads.
 */
const PRIME_MAX_FILES = 6;
const PRIME_MAX_CHARS = 60_000;

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
  const projectSnapshot = parseProjectSnapshot((body as { project?: unknown }).project);

  const projectFiles = createProjectFileReader({
    snapshot: projectSnapshot,
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
      const inspected: string[] = [];

      await setProgress("Reading the theme structure…");

      // The map, compact. JSON here cost two to three times the tokens to say
      // the same thing.
      let structureBlock = "";
      try {
        structureBlock = projectSnapshot?.structure
          ? `\n\nTHEME FILES:\n${renderStructureForPrompt(projectSnapshot.structure)}`
          : `\n\nTHEME FILES:\n${JSON.stringify(await projectFiles.list("theme"))}`;
      } catch {
        structureBlock = "";
      }

      // The plan already named the files this edit touches, and the site
      // already sent their contents. Handing them over now removes the
      // read_project_files round trip that every edit used to start with —
      // and a model that has the file in front of it edits it more faithfully
      // than one working from a path.
      let primedBlock = "";
      const primedPaths = [
        ...new Set(planSteps.flatMap((step) => step.files)),
      ].slice(0, PRIME_MAX_FILES);

      if (primedPaths.length > 0) {
        try {
          const primed = (await projectFiles.read("theme", primedPaths)) as {
            files?: { path?: unknown; content?: unknown }[];
          };

          const blocks: string[] = [];
          let budget = PRIME_MAX_CHARS;

          for (const file of primed.files ?? []) {
            if (typeof file.path !== "string" || typeof file.content !== "string") continue;
            if (file.content.length > budget) continue;

            budget -= file.content.length;
            blocks.push(`--- ${file.path} ---\n${file.content}`);
            inspected.push(file.path);
          }

          if (blocks.length > 0) {
            primedBlock =
              `\n\nCURRENT CONTENTS OF THE FILES IN THE PLAN ` +
              `(read them here, do not call read_project_files for these):\n\n` +
              blocks.join("\n\n");
          }
        } catch {
          primedBlock = "";
        }
      }

      const editModel = pickModel(modelConfig, "edit");
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
              structureBlock +
              primedBlock,
          },
        ],
        tools,
        // Doubled: 16k truncated a two-file change often enough to matter, and
        // ten rounds ran out on anything that had to read before it wrote.
        maxTokens: 32000,
        maxRounds: 20,
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
              // Name them. "Reading 3 files" tells the person the AI is busy;
              // naming the files tells them whether it is looking in the right
              // place, which is the only part they can act on.
              void setProgress(`Reading ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` +${paths.length - 3}` : ""}…`);
              return await projectFiles.read("theme", paths);
            }
            return { error: `Unknown tool: ${name}` };
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Tool failed." };
          }
        },
      });

      // Anchored edits are applied here, against the file exactly as the site
      // sent it. Deliberately NOT through projectFiles.read(): that caps a file
      // at 60 000 characters for the model's benefit, and applying an anchor to
      // a capped file and writing the result back would truncate it on disk.
      const parsed = parseEditOutput(result.text);
      const anchorResult = applyAnchoredEdits(parsed.anchors, (path) =>
        projectSnapshot?.files.get(path)
      );
      const changedFiles = mergeEditedFiles(parsed.files, anchorResult.files);

      await recordUsage(projectId, "edit", editModel, result.usage, {
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
        truncated: result.truncated,
        async: true,
      }, jobId);

      if (result.truncated || result.exhausted || changedFiles.length === 0) {
        const blocker =
          anchorResult.errors.length > 0
            ? anchorResult.errors.join(" ").slice(0, 400)
            : parsed.summary && parsed.summary !== "Updated the theme."
              ? parsed.summary.slice(0, 400)
              : "The editor could not produce a change for that. Try rephrasing.";
        // Truncation is checked first and on its own: the reply ended mid-file,
        // so parsed.files may look perfectly plausible while the last one is
        // half a stylesheet. Nothing here is written.
        const reason = result.truncated
          ? "The edit was cut short before the file was finished, so nothing was written. Ask for a smaller change — one section or one file at a time."
          : result.exhausted
            ? "The edit took too many steps. Try a more specific instruction."
            : blocker;
        await db
          .from("ai_jobs")
          .update({
            status: "error",
            error: reason,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        return;
      }

      // A second pair of eyes, on the cheap tier, over only what changed. It
      // runs before the job is marked done so the answer arrives with the Undo
      // button rather than after the user has already looked at the page.
      await setProgress("Checking the change…");
      const review = await reviewEdit({
        modelConfig,
        instruction,
        files: changedFiles,
      });

      await db
        .from("ai_jobs")
        .update({
          status: "done",
          result: {
            success: true,
            summary: parsed.summary,
            files: changedFiles,
            review: review.ok ? null : review.note,
            // An anchor that missed while others landed is worth saying out
            // loud: part of the request did not happen.
            notes: anchorResult.errors.slice(0, 6),
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
