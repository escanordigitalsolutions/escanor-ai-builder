import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import {
  rollbackProjectSnapshot,
  WordPressBridgeError,
} from "@/lib/wordpress/bridge";

/**
 * Roll back an applied deployment from the wp-admin editor (v3A, site-key auth).
 * Mirrors the browser rollback route: it restores the snapshot on the Bridge and
 * marks the run rolled_back. The Bridge refuses to overwrite a file edited after
 * the deployment unless forced, so this stays safe.
 */
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

  let runId = "";

  try {
    const body = await request.json();
    runId = typeof body?.runId === "string" ? body.runId.trim() : "";
  } catch {
    runId = "";
  }

  if (!runId) {
    return NextResponse.json(
      { success: false, error: "runId is required." },
      { status: 400 }
    );
  }

  const { data: run, error: runError } = await supabase
    .from("ai_apply_runs")
    .select("id, project_id, proposal_id, snapshot_id, status, result_json")
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
      error instanceof Error ? error.message : "WordPress rollback failed.";

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
