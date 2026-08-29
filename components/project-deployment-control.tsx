"use client";

import { useEffect, useState } from "react";

type ReadyProposal = {
  id: string;
  title: string;
  risk: "low" | "medium" | "high";
  approvedAt?: string | null;
  createdAt: string;
  fileCount: number;
  createCount: number;
  modifyCount: number;
  lastPreflightAt?: string | null;
  lastPreflightOk?: boolean | null;
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
  result?: any;
  createdAt: string;
  completedAt?: string | null;
  rolledBackAt?: string | null;
};

type BridgeStateData = {
  connected: boolean;
  version: string | null;
  controlledWrite: boolean;
  writeEnabled: boolean;
  createFiles: boolean;
  preflight: boolean;
  error: string | null;
};

type DeploymentData = {
  bridge: BridgeStateData;
  readyProposals: ReadyProposal[];
  deployments: Deployment[];
};

type PreflightFile = {
  index: number;
  ready: boolean;
  operation: "modify" | "create";
  scope: "theme" | "plugin";
  path: string;
  bytes: number;
  current_sha256?: string | null;
  syntax?: string;
  error?: {
    code?: string;
    message?: string;
  } | null;
};

type PreflightReport = {
  ready: boolean;
  write_enabled?: boolean;
  file_count?: number;
  total_bytes?: number;
  global_error?: string | null;
  files?: PreflightFile[];
  checked_at?: string;
  bridge_version?: string;
};

export default function ProjectDeploymentControl({
  projectId,
}: {
  projectId: string;
}) {
  const [data, setData] = useState<DeploymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preflights, setPreflights] = useState<Record<string, PreflightReport>>(
    {}
  );
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

  async function requestPreflight(proposalId: string) {
    const response = await fetch(
      `/api/projects/${projectId}/proposals/${proposalId}/preflight`,
      {
        method: "POST",
      }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error ?? "Proposal preflight failed.");
    }

    const report = result.preflight as PreflightReport;

    setPreflights((current) => ({
      ...current,
      [proposalId]: report,
    }));

    return report;
  }

  async function validateProposal(proposal: ReadyProposal) {
    if (busyId) {
      return;
    }

    setBusyId(`validate:${proposal.id}`);
    setError("");
    setNotice("");

    try {
      const report = await requestPreflight(proposal.id);

      if (report.ready) {
        setNotice(
          `Preflight passed for "${proposal.title}". ${proposal.modifyCount} modification(s), ${proposal.createCount} new file(s).`
        );
      } else {
        setError(firstPreflightError(report));
      }
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Proposal preflight failed."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function applyProposal(proposal: ReadyProposal) {
    if (busyId) {
      return;
    }

    setBusyId(`apply:${proposal.id}`);
    setError("");
    setNotice("");

    try {
      const report = await requestPreflight(proposal.id);

      if (!report.ready) {
        throw new Error(firstPreflightError(report));
      }

      const description = [
        proposal.modifyCount > 0
          ? `${proposal.modifyCount} existing file(s) modified`
          : null,
        proposal.createCount > 0
          ? `${proposal.createCount} new file(s) created`
          : null,
      ]
        .filter(Boolean)
        .join(" and ");

      if (
        !window.confirm(
          `Deploy "${proposal.title}" to the live WordPress project?\n\nPreflight is READY. ${description}. WordPress will snapshot the project, verify SHA-256 for edits, exclusively create new files, run health checks, and automatically roll back if deployment fails.`
        )
      ) {
        return;
      }

      const response = await fetch(
        `/api/projects/${projectId}/proposals/${proposal.id}/apply`,
        {
          method: "POST",
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        if (result.preflight) {
          setPreflights((current) => ({
            ...current,
            [proposal.id]: result.preflight,
          }));
        }

        throw new Error(result.error ?? "Could not apply proposal.");
      }

      setNotice(
        `Deployment successful. Snapshot: ${
          result.deployment.snapshotId ?? "created"
        }. Health checks passed.`
      );

      setPreflights((current) => {
        const next = { ...current };
        delete next[proposal.id];
        return next;
      });

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
        `Rollback "${deployment.proposalTitle}" using snapshot ${deployment.snapshotId}?\n\nModified files will be restored and files created by this deployment will be removed. Rollback stops instead of overwriting if a live file has changed since deployment.`
      )
    ) {
      return;
    }

    setBusyId(`rollback:${deployment.id}`);
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
    data.bridge.writeEnabled &&
    data.bridge.createFiles &&
    data.bridge.preflight;

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950/45">
      <div className="flex flex-col justify-between gap-4 border-b border-neutral-800 px-5 py-5 sm:flex-row sm:items-start sm:px-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-600">
            Build & deploy
          </p>

          <h2 className="mt-2 text-xl font-medium text-neutral-100">
            Deployment Control
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
            Validate live state → review readiness → snapshot → modify/create →
            verify → WordPress health checks → automatic rollback if needed.
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
            : !data.bridge.preflight || !data.bridge.createFiles
              ? "Install the Meikero Bridge plugin v0.5.0 or newer to use build-mode preflight and controlled new-file creation."
              : "Bridge v0.5 is installed, but controlled writes are disabled. In WordPress open Meikero → Controlled writes and enable them."}
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
                Preflight can be repeated without changing WordPress.
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
                  No approved proposals are waiting to be deployed.
                </p>
              )}

            {data?.readyProposals
              .filter((proposal) => proposal.ready)
              .map((proposal) => {
                const preflight = preflights[proposal.id];

                return (
                  <div
                    key={proposal.id}
                    className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-neutral-200">
                          {proposal.title}
                        </p>

                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-neutral-600">
                          {proposal.modifyCount > 0 && (
                            <span>{proposal.modifyCount} modify</span>
                          )}
                          {proposal.createCount > 0 && (
                            <span className="text-sky-300/80">
                              + {proposal.createCount} create
                            </span>
                          )}
                          <span>·</span>
                          <span className="uppercase">{proposal.risk} risk</span>
                        </div>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => validateProposal(proposal)}
                          disabled={!bridgeReady || Boolean(busyId)}
                          className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 disabled:opacity-35"
                        >
                          {busyId === `validate:${proposal.id}`
                            ? "Checking..."
                            : "Validate"}
                        </button>

                        <button
                          type="button"
                          onClick={() => applyProposal(proposal)}
                          disabled={!bridgeReady || Boolean(busyId)}
                          className="rounded-lg bg-neutral-100 px-3.5 py-2 text-xs font-medium text-neutral-950 hover:bg-white disabled:opacity-35"
                        >
                          {busyId === `apply:${proposal.id}`
                            ? "Deploying..."
                            : "Deploy"}
                        </button>
                      </div>
                    </div>

                    {preflight && (
                      <PreflightSummary report={preflight} />
                    )}

                    {!preflight && proposal.lastPreflightAt && (
                      <p className="mt-3 text-[11px] text-neutral-600">
                        Last saved preflight: {proposal.lastPreflightOk ? "READY" : "FAILED"} · {formatDate(proposal.lastPreflightAt)}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div>
            <p className="text-sm font-medium text-neutral-300">
              Deployment history
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              Every apply is backed by a local WordPress snapshot.
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {!loading && data?.deployments.length === 0 && (
              <p className="py-8 text-center text-sm text-neutral-600">
                No live deployments yet.
              </p>
            )}

            {data?.deployments.map((deployment) => {
              const appliedFiles = Array.isArray(deployment.result?.files)
                ? deployment.result.files
                : [];
              const createdCount = appliedFiles.filter(
                (file: any) => file?.operation === "create"
              ).length;

              return (
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
                        {createdCount > 0 ? ` · ${createdCount} created` : ""}
                        {deployment.snapshotId
                          ? ` · ${deployment.snapshotId}`
                          : ""}
                      </p>

                      {deployment.status === "applied" &&
                        deployment.result?.health?.ok === true && (
                          <p className="mt-2 text-[11px] text-emerald-400/70">
                            ✓ Home + REST health checks passed
                          </p>
                        )}

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
                          {busyId === `rollback:${deployment.id}`
                            ? "Rolling back..."
                            : "Rollback"}
                        </button>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-t border-neutral-800 px-5 py-4 text-[11px] leading-5 text-neutral-600 sm:px-6">
        Bridge v0.5 can modify existing approved files and create new allowlisted
        project files. It still cannot delete, rename or execute arbitrary files.
        Rollback restores modified files and removes files created by that
        deployment when their deployed SHA still matches.
      </div>
    </section>
  );
}

function PreflightSummary({ report }: { report: PreflightReport }) {
  const failed = (report.files ?? []).filter((file) => !file.ready);

  return (
    <div
      className={
        report.ready
          ? "mt-3 rounded-lg border border-emerald-900/50 bg-emerald-950/15 p-3"
          : "mt-3 rounded-lg border border-red-900/50 bg-red-950/15 p-3"
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={
            report.ready
              ? "text-xs font-medium text-emerald-300"
              : "text-xs font-medium text-red-300"
          }
        >
          {report.ready ? "✓ PREFLIGHT READY" : "PREFLIGHT FAILED"}
        </span>

        <span className="text-[10px] text-neutral-600">
          {formatBytes(report.total_bytes ?? 0)} · {report.file_count ?? 0} files
        </span>
      </div>

      {report.ready ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
          <span>✓ Paths allowed</span>
          <span>✓ SHA state current</span>
          <span>✓ PHP syntax valid</span>
          <span>✓ Size limits valid</span>
        </div>
      ) : (
        <div className="mt-2 space-y-1">
          {failed.slice(0, 3).map((file) => (
            <p key={`${file.scope}:${file.path}`} className="text-[11px] text-red-300/80">
              {file.scope}/{file.path}: {file.error?.message ?? "Not ready"}
            </p>
          ))}
          {report.global_error && (
            <p className="text-[11px] text-red-300/80">
              {report.global_error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BridgeState({ bridge }: { bridge: BridgeStateData | null }) {
  if (!bridge) {
    return (
      <span className="rounded-full border border-neutral-800 px-3 py-1.5 text-xs text-neutral-600">
        Checking Bridge...
      </span>
    );
  }

  const ready =
    bridge.connected &&
    bridge.controlledWrite &&
    bridge.writeEnabled &&
    bridge.createFiles &&
    bridge.preflight;

  return (
    <span
      className={
        ready
          ? "rounded-full border border-emerald-900/50 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300"
          : "rounded-full border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-500"
      }
    >
      {bridge.version ? `Bridge ${bridge.version}` : "Bridge"} · {" "}
      {ready ? "Build mode ready" : "Not ready"}
    </span>
  );
}

function Status({ status }: { status: Deployment["status"] }) {
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

function firstPreflightError(report: PreflightReport) {
  const failed = (report.files ?? []).find((file) => !file.ready);
  return (
    failed?.error?.message ??
    report.global_error ??
    "The live project is not ready for this proposal."
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}
