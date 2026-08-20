import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/security/encryption";
import {
  applyProjectChanges,
  WordPressBridgeError,
  type ProjectScope,
} from "@/lib/wordpress/bridge";

export async function POST(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      proposalId: string;
    }>;
  }
) {
  const { id, proposalId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }

  const { data: proposal, error: proposalError } = await supabase
    .from("ai_proposals")
    .select(`
      id,
      project_id,
      title,
      status,
      ai_proposal_files (
        scope,
        path,
        original_sha256,
        proposed_content
      )
    `)
    .eq("id", proposalId)
    .eq("project_id", id)
    .single();

  if (proposalError || !proposal) {
    return NextResponse.json(
      { success: false, error: "Proposal not found." },
      { status: 404 }
    );
  }

  if (proposal.status !== "approved") {
    return NextResponse.json(
      {
        success: false,
        error: "Only an approved proposal can be applied.",
      },
      { status: 409 }
    );
  }

  const files = Array.isArray(proposal.ai_proposal_files)
    ? proposal.ai_proposal_files
    : [];

  if (files.length < 1) {
    return NextResponse.json(
      { success: false, error: "Proposal has no files to apply." },
      { status: 409 }
    );
  }

  const { data: latestRun } = await supabase
    .from("ai_apply_runs")
    .select("id, status")
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRun?.status === "applying" || latestRun?.status === "applied") {
    return NextResponse.json(
      {
        success: false,
        error:
          latestRun.status === "applied"
            ? "This proposal is already applied. Roll it back before applying it again."
            : "This proposal is already being applied.",
      },
      { status: 409 }
    );
  }

  const { data: siteRow, error: siteError } = await supabase
    .from("wordpress_sites")
    .select("site_url, bridge_token_encrypted")
    .eq("project_id", id)
    .single();

  if (siteError || !siteRow) {
    return NextResponse.json(
      { success: false, error: "WordPress connection is missing." },
      { status: 404 }
    );
  }

  const { data: run, error: runError } = await supabase
    .from("ai_apply_runs")
    .insert({
      project_id: id,
      proposal_id: proposalId,
      status: "applying",
      files_count: files.length,
    })
    .select("id")
    .single();

  if (runError || !run) {
    return NextResponse.json(
      { success: false, error: "Could not create deployment record." },
      { status: 500 }
    );
  }

  try {
    const token = decryptSecret(siteRow.bridge_token_encrypted);

    const result = await applyProjectChanges(siteRow.site_url, token, {
      proposal_id: proposalId,
      files: files.map((file) => ({
        scope: file.scope as ProjectScope,
        path: file.path,
        expected_sha256: file.original_sha256,
        content: file.proposed_content,
      })),
    });

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("ai_apply_runs")
      .update({
        status: "applied",
        snapshot_id:
          typeof result?.snapshot_id === "string"
            ? result.snapshot_id
            : null,
        bridge_version:
          typeof result?.bridge_version === "string"
            ? result.bridge_version
            : null,
        result_json: result ?? {},
        completed_at: now,
      })
      .eq("id", run.id);

    if (updateError) {
      console.error("Deployment record update error:", updateError);
    }

    return NextResponse.json({
      success: true,
      deployment: {
        id: run.id,
        proposalId,
        proposalTitle: proposal.title,
        status: "applied",
        snapshotId: result?.snapshot_id ?? null,
        filesCount: files.length,
        bridgeVersion: result?.bridge_version ?? null,
        health: result?.health ?? null,
        completedAt: now,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "WordPress apply failed.";

    const detail =
      error instanceof WordPressBridgeError
        ? error.data
        : null;

    const now = new Date().toISOString();

    await supabase
      .from("ai_apply_runs")
      .update({
        status: "failed",
        error_text: message,
        result_json:
          detail && typeof detail === "object"
            ? detail
            : {
                error: message,
              },
        completed_at: now,
      })
      .eq("id", run.id);

    return NextResponse.json(
      {
        success: false,
        error: message,
        bridge: detail,
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
