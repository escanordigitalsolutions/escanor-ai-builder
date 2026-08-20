import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/security/encryption";
import {
  rollbackProjectSnapshot,
  WordPressBridgeError,
} from "@/lib/wordpress/bridge";

export async function POST(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      runId: string;
    }>;
  }
) {
  const { id, runId } = await params;
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

  const { data: run, error: runError } = await supabase
    .from("ai_apply_runs")
    .select(`
      id,
      project_id,
      proposal_id,
      snapshot_id,
      status,
      result_json
    `)
    .eq("id", runId)
    .eq("project_id", id)
    .single();

  if (runError || !run) {
    return NextResponse.json(
      { success: false, error: "Deployment not found." },
      { status: 404 }
    );
  }

  if (run.status !== "applied" || !run.snapshot_id) {
    return NextResponse.json(
      {
        success: false,
        error: "Only an applied deployment with a snapshot can be rolled back.",
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

  try {
    const token = decryptSecret(siteRow.bridge_token_encrypted);

    const result = await rollbackProjectSnapshot(
      siteRow.site_url,
      token,
      run.snapshot_id
    );

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("ai_apply_runs")
      .update({
        status: "rolled_back",
        result_json: {
          apply: run.result_json ?? {},
          rollback: result ?? {},
        },
        rolled_back_at: now,
      })
      .eq("id", run.id);

    if (updateError) {
      console.error("Rollback record update error:", updateError);
    }

    return NextResponse.json({
      success: true,
      deployment: {
        id: run.id,
        proposalId: run.proposal_id,
        snapshotId: run.snapshot_id,
        status: "rolled_back",
        rolledBackAt: now,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "WordPress rollback failed.";

    return NextResponse.json(
      {
        success: false,
        error: message,
        bridge:
          error instanceof WordPressBridgeError
            ? error.data
            : null,
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
