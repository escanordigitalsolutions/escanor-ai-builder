import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/security/encryption";
import {
  preflightProjectChanges,
  WordPressBridgeError,
  type ProjectFileOperation,
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
      status,
      ai_proposal_files (
        operation,
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

  if (proposal.status === "discarded") {
    return NextResponse.json(
      { success: false, error: "Discarded proposals cannot be validated." },
      { status: 409 }
    );
  }

  const files = Array.isArray(proposal.ai_proposal_files)
    ? proposal.ai_proposal_files
    : [];

  if (files.length < 1) {
    return NextResponse.json(
      { success: false, error: "Proposal has no files to validate." },
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

  try {
    const token = decryptSecret(siteRow.bridge_token_encrypted);

    const report = await preflightProjectChanges(
      siteRow.site_url,
      token,
      files.map((file) => ({
        operation: (file.operation ?? "modify") as ProjectFileOperation,
        scope: file.scope as ProjectScope,
        path: file.path,
        expected_sha256: file.original_sha256 ?? null,
        content: file.proposed_content,
      }))
    );

    const now = new Date().toISOString();

    await supabase
      .from("ai_proposals")
      .update({
        last_preflight_at: now,
        last_preflight_ok: report?.ready === true,
        last_preflight_json: report ?? {},
        updated_at: now,
      })
      .eq("id", proposalId);

    return NextResponse.json({
      success: true,
      proposalId,
      preflight: report,
      checkedAt: now,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Proposal preflight failed.";

    const detail =
      error instanceof WordPressBridgeError ? error.data : null;

    const now = new Date().toISOString();

    await supabase
      .from("ai_proposals")
      .update({
        last_preflight_at: now,
        last_preflight_ok: false,
        last_preflight_json:
          detail && typeof detail === "object"
            ? detail
            : {
                error: message,
              },
        updated_at: now,
      })
      .eq("id", proposalId);

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
