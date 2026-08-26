"use client";

import { FormEvent, useEffect, useState } from "react";

type DiffPart = {
  type: "added" | "removed" | "unchanged";
  value: string;
};

type ProposalFile = {
  id: string;
  operation: "modify" | "create";
  scope: "theme" | "plugin";
  path: string;
  summary: string;
  originalSha256: string | null;
  diff: DiffPart[];
};

type ProposalSummary = {
  id: string;
  title: string;
  summary: string;
  risk: "low" | "medium" | "high";
  status: "draft" | "approved" | "discarded";
  fileCount: number;
  totalTokens?: number;
  toolCalls?: number;
  createdAt: string;
};

type ProposalDetail = {
  id: string;
  requestText?: string;
  title: string;
  summary: string;
  risk: "low" | "medium" | "high";
  status: "draft" | "approved" | "discarded";
  createdAt: string;
  files: ProposalFile[];
};

export default function ProjectProposalEngine({
  projectId,
}: {
  projectId: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [active, setActive] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadProposals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function loadProposals() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/proposals`, {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not load proposals.");
      }

      const list: ProposalSummary[] = Array.isArray(data.proposals)
        ? data.proposals
        : [];

      setProposals(list);

      if (list[0]) {
        await loadProposal(list[0].id, false);
      } else {
        setActive(null);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load proposals."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadProposal(proposalId: string, showLoading = true) {
    if (showLoading) {
      setLoading(true);
    }

    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/proposals/${proposalId}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not load proposal.");
      }

      setActive(data.proposal);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load proposal."
      );
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  async function generateProposal(event: FormEvent) {
    event.preventDefault();

    const requestText = prompt.trim();

    if (!requestText || generating) {
      return;
    }

    setGenerating(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/proposals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: requestText,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not generate proposal.");
      }

      setPrompt("");

      const summary: ProposalSummary = {
        id: data.proposal.id,
        title: data.proposal.title,
        summary: data.proposal.summary,
        risk: data.proposal.risk,
        status: data.proposal.status,
        fileCount: Array.isArray(data.proposal.files)
          ? data.proposal.files.length
          : 0,
        totalTokens: data.proposal.usage?.totalTokens,
        toolCalls: data.proposal.toolCalls,
        createdAt: data.proposal.createdAt,
      };

      setProposals((current) => [
        summary,
        ...current.filter((proposal) => proposal.id !== summary.id),
      ]);

      setActive({
        id: data.proposal.id,
        title: data.proposal.title,
        summary: data.proposal.summary,
        risk: data.proposal.risk,
        status: data.proposal.status,
        createdAt: data.proposal.createdAt,
        files: Array.isArray(data.proposal.files) ? data.proposal.files : [],
      });
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not generate proposal."
      );
    } finally {
      setGenerating(false);
    }
  }

  async function setProposalStatus(status: "approved" | "discarded") {
    if (!active || active.status !== "draft" || updating) {
      return;
    }

    if (
      status === "approved" &&
      !window.confirm(
        "Approve this proposal? Approval does not change WordPress until you explicitly apply it in Deployment Control."
      )
    ) {
      return;
    }

    setUpdating(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/proposals/${active.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not update proposal.");
      }

      setActive((current) =>
        current
          ? {
              ...current,
              status,
            }
          : current
      );

      setProposals((current) =>
        current.map((proposal) =>
          proposal.id === active.id
            ? {
                ...proposal,
                status,
              }
            : proposal
        )
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not update proposal."
      );
    } finally {
      setUpdating(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-5 py-5 sm:px-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">
              AI change planner
            </p>

            <h2 className="mt-2 text-lg font-medium text-neutral-900">
              Proposal & Diff Engine
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
              AI inspects the live project and creates a reviewable change set.
              Review and approve here; live changes are applied separately through Deployment Control below.
            </p>
          </div>

          <div className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-500">
            READ → PROPOSE → REVIEW
          </div>
        </div>

        <form onSubmit={generateProposal} className="mt-5 flex flex-col gap-3">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the change you want, e.g. Make project cards more compact, add a deadline warning under 48 hours, and strengthen status badges."
            rows={3}
            disabled={generating}
            className="w-full resize-y rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400 disabled:opacity-50"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">
              Up to 6 files · modify or create · full-content proposals · SHA-256 pinned for edits
            </p>

            <button
              type="submit"
              disabled={generating || !prompt.trim()}
              className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
            >
              {generating ? "Inspecting & generating..." : "Generate proposal"}
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-neutral-200 p-3 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-2 py-2">
            <p className="text-xs font-medium text-neutral-500">
              Recent proposals
            </p>

            <button
              type="button"
              onClick={loadProposals}
              disabled={loading || generating}
              className="text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-40"
            >
              Refresh
            </button>
          </div>

          <div className="max-h-[420px] space-y-1 overflow-y-auto">
            {!loading && proposals.length === 0 && (
              <p className="px-2 py-6 text-xs text-neutral-500">
                No proposals yet.
              </p>
            )}

            {proposals.map((proposal) => {
              const selected = active?.id === proposal.id;

              return (
                <button
                  key={proposal.id}
                  type="button"
                  onClick={() => loadProposal(proposal.id)}
                  className={
                    selected
                      ? "w-full rounded-xl border border-neutral-200 bg-neutral-100 p-3 text-left"
                      : "w-full rounded-xl border border-transparent p-3 text-left transition hover:border-neutral-200 hover:bg-neutral-50"
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">
                      {proposal.title}
                    </span>

                    <RiskDot risk={proposal.risk} />
                  </div>

                  <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500">
                    <span>{proposal.fileCount} files</span>
                    <span>·</span>
                    <span className="capitalize">{proposal.status}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0 p-5 sm:p-6">
          {loading && !active && (
            <p className="py-16 text-center text-sm text-neutral-500">
              Loading proposals...
            </p>
          )}

          {!loading && !active && (
            <div className="py-16 text-center">
              <p className="text-neutral-500">
                Your first AI change proposal will appear here.
              </p>
              <p className="mt-2 text-sm text-neutral-500">
                Generate and approve a proposal here, then deploy it explicitly below.
              </p>
            </div>
          )}

          {active && (
            <div>
              <div className="flex flex-col justify-between gap-4 border-b border-neutral-200 pb-5 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={active.status} />
                    <RiskPill risk={active.risk} />
                  </div>

                  <h3 className="mt-3 text-2xl font-medium text-neutral-900">
                    {active.title}
                  </h3>

                  <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                    {active.summary}
                  </p>
                </div>

                <div className="text-xs text-neutral-500">
                  {formatDate(active.createdAt)}
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {active.files.map((file) => (
                  <ProposalFileDiff key={file.id} file={file} />
                ))}
              </div>

              <div className="mt-6 flex flex-col justify-between gap-4 border-t border-neutral-200 pt-5 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs text-neutral-500">
                    Approval does not modify WordPress by itself.
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Bridge v0.5 validates every approved change again before deployment.
                    New files are created exclusively and removed again on rollback.
                  </p>
                </div>

                {active.status === "draft" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setProposalStatus("discarded")}
                      disabled={updating}
                      className="rounded-lg border border-neutral-200 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                    >
                      Discard
                    </button>

                    <button
                      type="button"
                      onClick={() => setProposalStatus("approved")}
                      disabled={updating}
                      className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
                    >
                      Approve proposal
                    </button>
                  </div>
                ) : (
                  <StatusPill status={active.status} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ProposalFileDiff({ file }: { file: ProposalFile }) {
  return (
    <details
      open
      className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
    >
      <summary className="cursor-pointer select-none border-b border-neutral-200 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-neutral-200 bg-neutral-100 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-700">
                {file.scope}
              </span>

              <span
                className={
                  file.operation === "create"
                    ? "rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] uppercase tracking-wide text-sky-700"
                    : "rounded-md border border-neutral-200 bg-neutral-100 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-700"
                }
              >
                {file.operation}
              </span>

              <code className="truncate text-sm text-neutral-900">
                {file.path}
              </code>
            </div>

            <p className="mt-2 text-xs text-neutral-500">{file.summary}</p>
          </div>

          <code className="text-[10px] text-neutral-500">
            {file.operation === "create" || !file.originalSha256
              ? "NEW FILE"
              : `SHA ${file.originalSha256.slice(0, 10)}…`}
          </code>
        </div>
      </summary>

      <div className="max-h-[520px] overflow-auto bg-white font-mono text-[12px] leading-5">
        {file.diff.flatMap((part, partIndex) =>
          part.value.split("\n").map((line, lineIndex, lines) => {
            if (lineIndex === lines.length - 1 && line === "") {
              return [];
            }

            return (
              <div
                key={`${partIndex}-${lineIndex}`}
                className={
                  part.type === "added"
                    ? "border-l-2 border-green-200 bg-green-50 px-3 py-0.5 text-green-700"
                    : part.type === "removed"
                      ? "border-l-2 border-red-200 bg-red-50 px-3 py-0.5 text-red-700"
                      : "border-l-2 border-transparent px-3 py-0.5 text-neutral-600"
                }
              >
                <span className="mr-3 inline-block w-3 select-none text-neutral-400">
                  {part.type === "added"
                    ? "+"
                    : part.type === "removed"
                      ? "-"
                      : " "}
                </span>
                <span className="whitespace-pre">{line || " "}</span>
              </div>
            );
          })
        )}
      </div>
    </details>
  );
}

function RiskDot({ risk }: { risk: "low" | "medium" | "high" }) {
  return (
    <span
      title={`${risk} risk`}
      className={
        risk === "high"
          ? "mt-1 h-2 w-2 rounded-full bg-red-500"
          : risk === "medium"
            ? "mt-1 h-2 w-2 rounded-full bg-amber-400"
            : "mt-1 h-2 w-2 rounded-full bg-green-500"
      }
    />
  );
}

function RiskPill({ risk }: { risk: "low" | "medium" | "high" }) {
  return (
    <span
      className={
        risk === "high"
          ? "rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] uppercase tracking-wide text-red-700"
          : risk === "medium"
            ? "rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] uppercase tracking-wide text-amber-700"
            : "rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] uppercase tracking-wide text-green-700"
      }
    >
      {risk} risk
    </span>
  );
}

function StatusPill({
  status,
}: {
  status: "draft" | "approved" | "discarded";
}) {
  return (
    <span
      className={
        status === "approved"
          ? "rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] uppercase tracking-wide text-green-700"
          : status === "discarded"
            ? "rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] uppercase tracking-wide text-neutral-500"
            : "rounded-full border border-neutral-200 bg-neutral-100 px-2.5 py-1 text-[11px] uppercase tracking-wide text-neutral-700"
      }
    >
      {status}
    </span>
  );
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}
