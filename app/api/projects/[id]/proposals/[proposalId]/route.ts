import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function getOwnedProposal(projectId: string, proposalId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "Unauthorized." },
        { status: 401 }
      ),
    };
  }

  const { data: proposal, error } = await supabase
    .from("ai_proposals")
    .select(`
      id,
      project_id,
      request_text,
      title,
      summary,
      risk,
      status,
      model,
      input_tokens,
      output_tokens,
      total_tokens,
      tool_calls,
      theme_fingerprint,
      plugin_fingerprint,
      last_preflight_at,
      last_preflight_ok,
      last_preflight_json,
      created_at,
      updated_at,
      approved_at,
      discarded_at
    `)
    .eq("id", proposalId)
    .eq("project_id", projectId)
    .single();

  if (error || !proposal) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "Proposal not found." },
        { status: 404 }
      ),
    };
  }

  return {
    ok: true as const,
    supabase,
    proposal,
  };
}

export async function GET(
  _request: NextRequest,
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
  const owned = await getOwnedProposal(id, proposalId);

  if (!owned.ok) {
    return owned.response;
  }

  const { data: files, error: filesError } = await owned.supabase
    .from("ai_proposal_files")
    .select(`
      id,
      operation,
      scope,
      path,
      change_summary,
      original_sha256,
      diff_json,
      created_at
    `)
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: true });

  if (filesError) {
    return NextResponse.json(
      { success: false, error: "Could not load proposal files." },
      { status: 500 }
    );
  }

  const proposal = owned.proposal;

  return NextResponse.json({
    success: true,
    proposal: {
      id: proposal.id,
      requestText: proposal.request_text,
      title: proposal.title,
      summary: proposal.summary,
      risk: proposal.risk,
      status: proposal.status,
      model: proposal.model,
      usage: {
        inputTokens: proposal.input_tokens,
        outputTokens: proposal.output_tokens,
        totalTokens: proposal.total_tokens,
      },
      toolCalls: proposal.tool_calls,
      themeFingerprint: proposal.theme_fingerprint,
      pluginFingerprint: proposal.plugin_fingerprint,
      lastPreflightAt: proposal.last_preflight_at,
      lastPreflightOk: proposal.last_preflight_ok,
      lastPreflight: proposal.last_preflight_json,
      createdAt: proposal.created_at,
      updatedAt: proposal.updated_at,
      approvedAt: proposal.approved_at,
      discardedAt: proposal.discarded_at,
      files: (files ?? []).map((file) => ({
        id: file.id,
        operation: file.operation,
        scope: file.scope,
        path: file.path,
        summary: file.change_summary,
        originalSha256: file.original_sha256,
        diff: Array.isArray(file.diff_json) ? file.diff_json : [],
      })),
    },
  });
}

export async function PATCH(
  request: NextRequest,
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
  const owned = await getOwnedProposal(id, proposalId);

  if (!owned.ok) {
    return owned.response;
  }

  const body = await request.json();
  const status =
    body.status === "approved" || body.status === "discarded"
      ? body.status
      : null;

  if (!status) {
    return NextResponse.json(
      {
        success: false,
        error: "Status must be approved or discarded.",
      },
      { status: 400 }
    );
  }

  if (owned.proposal.status !== "draft") {
    return NextResponse.json(
      {
        success: false,
        error: `Proposal is already ${owned.proposal.status}.`,
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  const { data: updated, error } = await owned.supabase
    .from("ai_proposals")
    .update({
      status,
      updated_at: now,
      approved_at: status === "approved" ? now : null,
      discarded_at: status === "discarded" ? now : null,
    })
    .eq("id", proposalId)
    .select("id, status, updated_at, approved_at, discarded_at")
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { success: false, error: "Could not update proposal." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    proposal: {
      id: updated.id,
      status: updated.status,
      updatedAt: updated.updated_at,
      approvedAt: updated.approved_at,
      discardedAt: updated.discarded_at,
    },
    liveChanged: false,
    message:
      status === "approved"
        ? "Proposal approved. Run preflight again before explicit deployment."
        : "Proposal discarded. No WordPress files were changed.",
  });
}
