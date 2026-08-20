"use client";

import { useEffect, useState } from "react";

type ReadyProposal = {
  id: string;
  title: string;
  risk: "low" | "medium" | "high";
  approvedAt?: string | null;
  createdAt: string;
  fileCount: number;
  latestDeploymentStatus?: string | null;
  ready: boolean;
};

type Deployment = {
  id: string;
  proposalId: string;
  proposalTitle: string;
  risk: string;
  snapshotId?: string | null;
  status: "applying" | "applied" | "failed" | "rolled_back";
  filesCount: number;
  bridgeVersion?: string | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
  rolledBackAt?: string | null;
};

type DeploymentData = {
  bridge: {
    connected: boolean;
    version: string | null;
    controlledWrite: boolean;
    writeEnabled: boolean;
    error: string | null;
  };
  readyProposals: ReadyProposal[];
  deployments: Deployment[];
};

export default function ProjectDeploymentControl({
  projectId,
}: {
  projectId: string;
}) {
  const [data, setData] = useState<DeploymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/deployments`, {
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Could not load deployment control.");
      }

      setData({
        bridge: result.bridge,
        readyProposals: Array.isArray(result.readyProposals)
          ? result.readyProposals
          : [],
        deployments: Array.isArray(result.deployments)
          ? result.deployments
          : [],
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load deployment control."
      );
    } finally {
      setLoading(false);
    }
  }

  async function applyProposal(proposal: ReadyProposal) {
    if (
      busyId ||
      !window.confirm(
        `Apply "${proposal.title}" to the live WordPress project?\n\n${proposal.fileCount} existing file(s) will be SHA-verified. WordPress will create a snapshot before writing and automatically roll back if verification or the health check fails.`
      )
    ) {
      return;
    }

    setBusyId(proposal.id);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/proposals/${proposal.id}/apply`,
        {
          method: "POST",
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Could not apply proposal.");
      }

      setNotice(
        `Applied successfully. Snapshot: ${
          result.deployment.snapshotId ?? "created"
        }.`
      );

      await load();
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "Could not apply proposal."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function rollbackDeployment(deployment: Deployment) {
    if (
      busyId ||
      !window.confirm(
        `Rollback "${deployment.proposalTitle}" using snapshot ${deployment.snapshotId}?\n\nRollback stops instead of overwriting if a live file has changed since this deployment.`
      )
    ) {
      return;
    }

    setBusyId(deployment.id);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/deployments/${deployment.id}/rollback`,
        {
          method: "POST",
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Could not rollback deployment.");
      }

      setNotice(`Rollback completed: ${deployment.snapshotId}.`);
      await load();
    } catch (rollbackError) {
      setError(
        rollbackError instanceof Error
          ? rollbackError.message
          : "Could not rollback deployment."
      );
    } finally {
      setBusyId(null);
    }
  }

  const bridgeReady =
    data?.bridge.connected &&
    data.bridge.controlledWrite &&
    data.bridge.writeEnabled;

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950/45">
      <div className="flex flex-col justify-between gap-4 border-b border-neutral-800 px-5 py-5 sm:flex-row sm:items-start sm:px-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-600">
            Live deployment
          </p>

          <h2 className="mt-2 text-xl font-medium text-neutral-100">
            Deployment Control
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
            Approved proposal → SHA verification → protected snapshot → atomic
            apply → site health check → rollback if needed.
          </p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <BridgeState bridge={data?.bridge ?? null} />

          <button
            type="button"
            onClick={load}
            disabled={loading || Boolean(busyId)}
            className="text-xs text-neutral-600 hover:text-neutral-300 disabled:opacity-40"
          >
            Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="mx-5 mt-5 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3 text-sm text-emerald-300 sm:mx-6">
          {notice}
        </div>
      )}

      {error && (
        <div className="mx-5 mt-5 rounded-lg border border-red-900/70 bg-red-950/30 p-3 text-sm text-red-300 sm:mx-6">
          {error}
        </div>
      )}

      {!loading && data && !bridgeReady && (
        <div className="mx-5 mt-5 rounded-xl border border-amber-900/40 bg-amber-950/15 p-4 text-sm text-amber-200/80 sm:mx-6">
          {!data.bridge.connected
            ? `Bridge status unavailable${
                data.bridge.error ? `: ${data.bridge.error}` : "."
              }`
            : !data.bridge.controlledWrite
            ? "Install WP AI Builder Bridge v0.4.0 or newer before live apply."
            : "Bridge v0.4 is installed, but controlled writes are disabled. In WordPress open AI Builder → Controlled writes and enable them."}
        </div>
      )}

      <div className="grid lg:grid-cols-2">
        <div className="border-b border-neutral-800 p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-300">
                Approved proposals
              </p>
              <p className="mt-1 text-xs text-neutral-600">
                Explicit apply is always required.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loading && (
              <p className="py-8 text-center text-sm text-neutral-600">
                Loading approved proposals...
              </p>
            )}

            {!loading &&
              data?.readyProposals.filter((proposal) => proposal.ready).length ===
                0 && (
                <p className="py-8 text-center text-sm text-neutral-600">
                  No approved proposals are waiting to be applied.
                </p>
              )}

            {data?.readyProposals
              .filter((proposal) => proposal.ready)
              .map((proposal) => (
                <div
                  key={proposal.id}
                  className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-neutral-200">
                        {proposal.title}
                      </p>
                      <p className="mt-1 text-xs text-neutral-600">
                        {proposal.fileCount} file
                        {proposal.fileCount === 1 ? "" : "s"} ·{" "}
                        <span className="uppercase">{proposal.risk} risk</span>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => applyProposal(proposal)}
                      disabled={!bridgeReady || Boolean(busyId)}
                      className="shrink-0 rounded-lg bg-neutral-100 px-3.5 py-2 text-xs font-medium text-neutral-950 hover:bg-white disabled:opacity-35"
                    >
                      {busyId === proposal.id ? "Applying..." : "Apply changes"}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div>
            <p className="text-sm font-medium text-neutral-300">
              Deployment history
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              Snapshots remain recoverable from both SaaS and wp-admin.
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {!loading && data?.deployments.length === 0 && (
              <p className="py-8 text-center text-sm text-neutral-600">
                No live deployments yet.
              </p>
            )}

            {data?.deployments.map((deployment) => (
              <div
                key={deployment.id}
                className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Status status={deployment.status} />
                      <span className="truncate text-sm text-neutral-300">
                        {deployment.proposalTitle}
                      </span>
                    </div>

                    <p className="mt-2 text-[11px] text-neutral-600">
                      {deployment.filesCount} files
                      {deployment.snapshotId
                        ? ` · ${deployment.snapshotId}`
                        : ""}
                    </p>

                    {deployment.error && (
                      <p className="mt-2 text-xs leading-5 text-red-300/80">
                        {deployment.error}
                      </p>
                    )}
                  </div>

                  {deployment.status === "applied" &&
                    deployment.snapshotId && (
                      <button
                        type="button"
                        onClick={() => rollbackDeployment(deployment)}
                        disabled={!bridgeReady || Boolean(busyId)}
                        className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 disabled:opacity-35"
                      >
                        {busyId === deployment.id
                          ? "Rolling back..."
                          : "Rollback"}
                      </button>
                    )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-neutral-800 px-5 py-4 text-[11px] leading-5 text-neutral-600 sm:px-6">
        v0.4 modifies existing approved project files only. It cannot create,
        delete or execute arbitrary files. Manual rollback is conflict-aware:
        newer live edits stop the rollback instead of being overwritten.
      </div>
    </section>
  );
}

function BridgeState({
  bridge,
}: {
  bridge:
    | {
        connected: boolean;
        version: string | null;
        controlledWrite: boolean;
        writeEnabled: boolean;
        error: string | null;
      }
    | null;
}) {
  if (!bridge) {
    return (
      <span className="rounded-full border border-neutral-800 px-3 py-1.5 text-xs text-neutral-600">
        Checking Bridge...
      </span>
    );
  }

  const ready =
    bridge.connected && bridge.controlledWrite && bridge.writeEnabled;

  return (
    <span
      className={
        ready
          ? "rounded-full border border-emerald-900/50 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300"
          : "rounded-full border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-500"
      }
    >
      {bridge.version ? `Bridge ${bridge.version}` : "Bridge"} ·{" "}
      {ready ? "Writes enabled" : "Not ready"}
    </span>
  );
}

function Status({
  status,
}: {
  status: Deployment["status"];
}) {
  const className =
    status === "applied"
      ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-300"
      : status === "failed"
      ? "border-red-900/60 bg-red-950/20 text-red-300"
      : status === "rolled_back"
      ? "border-amber-900/50 bg-amber-950/20 text-amber-300"
      : "border-neutral-700 bg-neutral-900 text-neutral-400";

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${className}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
