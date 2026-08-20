import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/security/encryption";
import {
  getBridgeStatus,
  WordPressBridgeError,
} from "@/lib/wordpress/bridge";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select(`
      id,
      wordpress_sites (
        site_url,
        bridge_token_encrypted
      )
    `)
    .eq("id", id)
    .single();

  if (projectError || !project) {
    return NextResponse.json(
      { success: false, error: "Project not found." },
      { status: 404 }
    );
  }

  const { data: proposals, error: proposalsError } = await supabase
    .from("ai_proposals")
    .select(`
      id,
      title,
      risk,
      status,
      approved_at,
      created_at,
      last_preflight_at,
      last_preflight_ok,
      ai_proposal_files (
        id,
        operation
      )
    `)
    .eq("project_id", id)
    .eq("status", "approved")
    .order("approved_at", { ascending: false });

  if (proposalsError) {
    return NextResponse.json(
      { success: false, error: "Could not load approved proposals." },
      { status: 500 }
    );
  }

  const { data: runs, error: runsError } = await supabase
    .from("ai_apply_runs")
    .select(`
      id,
      proposal_id,
      snapshot_id,
      status,
      files_count,
      bridge_version,
      error_text,
      result_json,
      created_at,
      completed_at,
      rolled_back_at,
      ai_proposals (
        title,
        risk
      )
    `)
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (runsError) {
    return NextResponse.json(
      { success: false, error: "Could not load deployment history." },
      { status: 500 }
    );
  }

  const latestStatus = new Map<string, string>();

  for (const run of runs ?? []) {
    if (!latestStatus.has(run.proposal_id)) {
      latestStatus.set(run.proposal_id, run.status);
    }
  }

  const wordpressSites = project.wordpress_sites;
  const site = Array.isArray(wordpressSites)
    ? wordpressSites[0]
    : wordpressSites;

  let bridge = {
    connected: false,
    version: null as string | null,
    controlledWrite: false,
    writeEnabled: false,
    createFiles: false,
    preflight: false,
    error: null as string | null,
  };

  if (site?.site_url && site?.bridge_token_encrypted) {
    try {
      const token = decryptSecret(site.bridge_token_encrypted);
      const status = await getBridgeStatus(site.site_url, token);

      bridge = {
        connected: true,
        version:
          typeof status?.bridge?.version === "string"
            ? status.bridge.version
            : null,
        controlledWrite: status?.capabilities?.controlled_write === true,
        writeEnabled: status?.capabilities?.write_files === true,
        createFiles: status?.capabilities?.create_files === true,
        preflight: status?.capabilities?.preflight === true,
        error: null,
      };
    } catch (error) {
      bridge.error =
        error instanceof WordPressBridgeError || error instanceof Error
          ? error.message
          : "Could not read Bridge status.";
    }
  }

  return NextResponse.json({
    success: true,
    bridge,
    readyProposals: (proposals ?? []).map((proposal) => {
      const status = latestStatus.get(proposal.id) ?? null;
      const files = Array.isArray(proposal.ai_proposal_files)
        ? proposal.ai_proposal_files
        : [];

      return {
        id: proposal.id,
        title: proposal.title,
        risk: proposal.risk,
        approvedAt: proposal.approved_at,
        createdAt: proposal.created_at,
        fileCount: files.length,
        createCount: files.filter((file) => file.operation === "create").length,
        modifyCount: files.filter((file) => file.operation !== "create").length,
        lastPreflightAt: proposal.last_preflight_at,
        lastPreflightOk: proposal.last_preflight_ok,
        latestDeploymentStatus: status,
        ready: status !== "applying" && status !== "applied",
      };
    }),
    deployments: (runs ?? []).map((run) => {
      const proposal = Array.isArray(run.ai_proposals)
        ? run.ai_proposals[0]
        : run.ai_proposals;

      return {
        id: run.id,
        proposalId: run.proposal_id,
        proposalTitle: proposal?.title ?? "Proposal",
        risk: proposal?.risk ?? "medium",
        snapshotId: run.snapshot_id,
        status: run.status,
        filesCount: run.files_count,
        bridgeVersion: run.bridge_version,
        error: run.error_text,
        result: run.result_json,
        createdAt: run.created_at,
        completedAt: run.completed_at,
        rolledBackAt: run.rolled_back_at,
      };
    }),
  });
}
