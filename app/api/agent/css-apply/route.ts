import { NextRequest, NextResponse } from "next/server";
import { diffLines } from "diff";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import {
  applyProjectChanges,
  getBridgeManifest,
  preflightProjectChanges,
  readProjectFile,
  WordPressBridgeError,
} from "@/lib/wordpress/bridge";

/**
 * Deterministic CSS apply for the wp-admin Visual editor (v3A, site-key auth).
 *
 * The "CSS fast path": no model, no tokens. It writes the editor's accumulated
 * CSS into a managed block in the theme stylesheet, reusing the same
 * preflight + snapshot + apply guarantees as an AI proposal (so it shows up in
 * Deployments and rolls back the same way).
 */

const BEGIN_MARK = "/* BEGIN WPAB Visual CSS */";
const END_MARK = "/* END WPAB Visual CSS */";
const TARGET_SCOPE = "theme" as const;
const TARGET_PATH = "style.css";

function injectManagedBlock(current: string, css: string) {
  const block = `${BEGIN_MARK}\n${css.trim()}\n${END_MARK}`;
  const begin = current.indexOf(BEGIN_MARK);
  const end = current.indexOf(END_MARK);

  if (begin !== -1 && end !== -1 && end > begin) {
    return current.slice(0, begin) + block + current.slice(end + END_MARK.length);
  }

  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  return `${current}${separator}${block}\n`;
}

function makeDiff(original: string, proposed: string) {
  return diffLines(original, proposed).map((part) => ({
    type: part.added ? "added" : part.removed ? "removed" : "unchanged",
    value: part.value,
  }));
}

function themeFileMeta(manifest: any) {
  const files = manifest?.scopes?.theme?.files;

  if (!Array.isArray(files)) {
    return null;
  }

  const match = files.find(
    (file) => file && file.path === TARGET_PATH && typeof file.sha256 === "string"
  );

  return match
    ? { sha256: match.sha256 as string }
    : null;
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  const id = auth.context.projectId;
  const supabase = createServiceClient();

  let css = "";

  try {
    const body = await request.json();
    css = typeof body?.css === "string" ? body.css : "";
  } catch {
    css = "";
  }

  css = css.trim();

  if (!css) {
    return NextResponse.json(
      { success: false, error: "No CSS to apply." },
      { status: 400 }
    );
  }

  if (css.length > 40000) {
    return NextResponse.json(
      { success: false, error: "CSS is too large." },
      { status: 400 }
    );
  }

  const { data: siteRow, error: siteError } = await supabase
    .from("wordpress_sites")
    .select("site_url, bridge_token_encrypted")
    .eq("project_id", id)
    .single();

  if (siteError || !siteRow || !siteRow.site_url || !siteRow.bridge_token_encrypted) {
    return NextResponse.json(
      { success: false, error: "WordPress connection is missing." },
      { status: 404 }
    );
  }

  let token: string;
  try {
    token = decryptSecret(siteRow.bridge_token_encrypted);
  } catch {
    return NextResponse.json(
      { success: false, error: "Could not decrypt WordPress connection." },
      { status: 500 }
    );
  }

  try {
    const manifest = await getBridgeManifest(siteRow.site_url, token);
    const meta = themeFileMeta(manifest);

    if (!meta) {
      return NextResponse.json(
        {
          success: false,
          error: "The theme has no writable style.css, so visual CSS cannot be applied yet.",
        },
        { status: 409 }
      );
    }

    const liveFile = await readProjectFile(
      siteRow.site_url,
      token,
      TARGET_SCOPE,
      TARGET_PATH
    );

    const originalContent =
      liveFile && typeof liveFile === "object" && typeof (liveFile as any).content === "string"
        ? (liveFile as any).content
        : null;

    if (originalContent === null) {
      return NextResponse.json(
        { success: false, error: "Could not read the theme stylesheet." },
        { status: 502 }
      );
    }

    const proposedContent = injectManagedBlock(originalContent, css);

    if (proposedContent === originalContent) {
      return NextResponse.json(
        { success: false, error: "This visual change is already applied." },
        { status: 409 }
      );
    }

    const bridgeFile = {
      operation: "modify" as const,
      scope: TARGET_SCOPE,
      path: TARGET_PATH,
      expected_sha256: meta.sha256,
      content: proposedContent,
    };

    const preflight = await preflightProjectChanges(siteRow.site_url, token, [
      bridgeFile,
    ]);

    if (preflight?.ready !== true) {
      const files = Array.isArray(preflight?.files) ? preflight.files : [];
      const failed = files.find((file: any) => file?.ready === false);
      const message =
        (failed?.error && typeof failed.error.message === "string" && failed.error.message) ||
        "The live stylesheet changed. Reload the preview and try again.";

      return NextResponse.json(
        { success: false, error: message, preflight },
        { status: 409 }
      );
    }

    // Record it as an approved, deterministic proposal so it lives in the same
    // Deployments + rollback flow as an AI change.
    const { data: proposal, error: proposalError } = await supabase
      .from("ai_proposals")
      .insert({
        project_id: id,
        request_text: "Visual editor: CSS overrides",
        title: "Visual CSS edit",
        summary: "Applied custom CSS overrides from the Visual editor.",
        risk: "low",
        status: "approved",
        model: "visual",
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        tool_calls: 0,
        theme_fingerprint: manifest?.scopes?.theme?.fingerprint ?? null,
        approved_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (proposalError || !proposal) {
      throw new Error(proposalError?.message ?? "Could not record the change.");
    }

    const { error: fileError } = await supabase.from("ai_proposal_files").insert({
      proposal_id: proposal.id,
      operation: "modify",
      scope: TARGET_SCOPE,
      path: TARGET_PATH,
      change_summary: "Managed Visual CSS block in the theme stylesheet",
      original_sha256: meta.sha256,
      original_content: originalContent,
      proposed_content: proposedContent,
      diff_json: makeDiff(originalContent, proposedContent),
    });

    if (fileError) {
      await supabase.from("ai_proposals").delete().eq("id", proposal.id);
      throw new Error(fileError.message);
    }

    const { data: run, error: runError } = await supabase
      .from("ai_apply_runs")
      .insert({
        project_id: id,
        proposal_id: proposal.id,
        status: "applying",
        files_count: 1,
      })
      .select("id")
      .single();

    if (runError || !run) {
      throw new Error("Could not create a deployment record.");
    }

    try {
      const result = await applyProjectChanges(siteRow.site_url, token, {
        proposal_id: proposal.id,
        files: [bridgeFile],
      });

      const now = new Date().toISOString();

      await supabase
        .from("ai_apply_runs")
        .update({
          status: "applied",
          snapshot_id: typeof result?.snapshot_id === "string" ? result.snapshot_id : null,
          bridge_version: typeof result?.bridge_version === "string" ? result.bridge_version : null,
          result_json: result ?? {},
          completed_at: now,
        })
        .eq("id", run.id);

      return NextResponse.json({
        success: true,
        deployment: {
          id: run.id,
          proposalId: proposal.id,
          proposalTitle: "Visual CSS edit",
          status: "applied",
          snapshotId: result?.snapshot_id ?? null,
          filesCount: 1,
          completedAt: now,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "WordPress apply failed.";
      const now = new Date().toISOString();

      await supabase
        .from("ai_apply_runs")
        .update({
          status: "failed",
          error_text: message,
          result_json:
            error instanceof WordPressBridgeError && error.data && typeof error.data === "object"
              ? error.data
              : { error: message },
          completed_at: now,
        })
        .eq("id", run.id);

      return NextResponse.json(
        {
          success: false,
          error: message,
          bridge: error instanceof WordPressBridgeError ? error.data : null,
        },
        {
          status:
            error instanceof WordPressBridgeError
              ? Math.max(400, Math.min(error.status, 599))
              : 500,
        }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not apply visual CSS.";

    return NextResponse.json(
      {
        success: false,
        error: message,
        bridge: error instanceof WordPressBridgeError ? error.data : null,
      },
      {
        status:
          error instanceof WordPressBridgeError
            ? Math.max(400, Math.min(error.status, 599))
            : 500,
      }
    );
  }
}
