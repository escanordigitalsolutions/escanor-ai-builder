"use client";

import { FormEvent, useEffect, useState } from "react";

type DiffPart = {
  type: "added" | "removed" | "unchanged";
  value: string;
};

type ProposalFile = {
  id: string;
  scope: "theme" | "plugin";
  path: string;
  summary: string;
  originalSha256: string;
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
    <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950/45">
      <div className="border-b border-neutral-800 px-5 py-5 sm:px-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-600">
              AI change planner
            </p>

            <h2 className="mt-2 text-xl font-medium text-neutral-100">
              Proposal & Diff Engine
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
              AI inspects the live project and creates a reviewable change set.
              Review and approve here; live changes are applied separately through Deployment Control below.
            </p>
          </div>

          <div className="rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1.5 text-xs text-neutral-500">
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
            className="w-full resize-y rounded-xl border border-neutral-700 bg-neutral-900/80 px-4 py-3 text-sm leading-6 text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500 disabled:opacity-50"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-neutral-600">
              Up to 4 existing files · full-content proposals · SHA-256 pinned
            </p>

            <button
              type="submit"
              disabled={generating || !prompt.trim()}
              className="rounded-lg bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-white disabled:opacity-40"
            >
              {generating ? "Inspecting & generating..." : "Generate proposal"}
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-4 rounded-lg border border-red-900/70 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-neutral-800 p-3 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-2 py-2">
            <p className="text-xs font-medium text-neutral-500">
              Recent proposals
            </p>

            <button
              type="button"
              onClick={loadProposals}
              disabled={loading || generating}
              className="text-xs text-neutral-600 hover:text-neutral-300 disabled:opacity-40"
            >
              Refresh
            </button>
          </div>

          <div className="max-h-[420px] space-y-1 overflow-y-auto">
            {!loading && proposals.length === 0 && (
              <p className="px-2 py-6 text-xs text-neutral-600">
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
                      ? "w-full rounded-xl border border-neutral-700 bg-neutral-800/80 p-3 text-left"
                      : "w-full rounded-xl border border-transparent p-3 text-left transition hover:border-neutral-800 hover:bg-neutral-900/60"
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                      {proposal.title}
                    </span>

                    <RiskDot risk={proposal.risk} />
                  </div>

                  <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-600">
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
            <p className="py-16 text-center text-sm text-neutral-600">
              Loading proposals...
            </p>
          )}

          {!loading && !active && (
            <div className="py-16 text-center">
              <p className="text-neutral-400">
                Your first AI change proposal will appear here.
              </p>
              <p className="mt-2 text-sm text-neutral-600">
                Generate and approve a proposal here, then deploy it explicitly below.
              </p>
            </div>
          )}

          {active && (
            <div>
              <div className="flex flex-col justify-between gap-4 border-b border-neutral-800 pb-5 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={active.status} />
                    <RiskPill risk={active.risk} />
                  </div>

                  <h3 className="mt-3 text-2xl font-medium text-neutral-100">
                    {active.title}
                  </h3>

                  <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                    {active.summary}
                  </p>
                </div>

                <div className="text-xs text-neutral-600">
                  {formatDate(active.createdAt)}
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {active.files.map((file) => (
                  <ProposalFileDiff key={file.id} file={file} />
                ))}
              </div>

              <div className="mt-6 flex flex-col justify-between gap-4 border-t border-neutral-800 pt-5 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs text-neutral-500">
                    Approval does not modify WordPress by itself.
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-700">
                    Controlled apply + snapshot + rollback arrives with Bridge
                    v0.4.
                  </p>
                </div>

                {active.status === "draft" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setProposalStatus("discarded")}
                      disabled={updating}
                      className="rounded-lg border border-neutral-700 px-4 py-2.5 text-sm text-neutral-400 hover:bg-neutral-900 disabled:opacity-40"
                    >
                      Discard
                    </button>

                    <button
                      type="button"
                      onClick={() => setProposalStatus("approved")}
                      disabled={updating}
                      className="rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-950 hover:bg-white disabled:opacity-40"
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
      className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/60"
    >
      <summary className="cursor-pointer select-none border-b border-neutral-800 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-500">
                {file.scope}
              </span>

              <code className="truncate text-sm text-neutral-200">
                {file.path}
              </code>
            </div>

            <p className="mt-2 text-xs text-neutral-500">{file.summary}</p>
          </div>

          <code className="text-[10px] text-neutral-700">
            SHA {file.originalSha256.slice(0, 10)}…
          </code>
        </div>
      </summary>

      <div className="max-h-[520px] overflow-auto bg-[#090b0d] font-mono text-[12px] leading-5">
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
                    ? "border-l-2 border-emerald-700/70 bg-emerald-950/25 px-3 py-0.5 text-emerald-200/90"
                    : part.type === "removed"
                      ? "border-l-2 border-rose-800/70 bg-rose-950/20 px-3 py-0.5 text-rose-200/75"
                      : "border-l-2 border-transparent px-3 py-0.5 text-neutral-500"
                }
              >
                <span className="mr-3 inline-block w-3 select-none text-neutral-700">
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
          ? "mt-1 h-2 w-2 rounded-full bg-rose-400"
          : risk === "medium"
            ? "mt-1 h-2 w-2 rounded-full bg-amber-300"
            : "mt-1 h-2 w-2 rounded-full bg-neutral-400"
      }
    />
  );
}

function RiskPill({ risk }: { risk: "low" | "medium" | "high" }) {
  return (
    <span
      className={
        risk === "high"
          ? "rounded-full border border-rose-900/70 bg-rose-950/30 px-2.5 py-1 text-[11px] uppercase tracking-wide text-rose-300"
          : risk === "medium"
            ? "rounded-full border border-amber-900/60 bg-amber-950/20 px-2.5 py-1 text-[11px] uppercase tracking-wide text-amber-300"
            : "rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[11px] uppercase tracking-wide text-neutral-400"
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
          ? "rounded-full border border-emerald-900/60 bg-emerald-950/20 px-2.5 py-1 text-[11px] uppercase tracking-wide text-emerald-300"
          : status === "discarded"
            ? "rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] uppercase tracking-wide text-neutral-600"
            : "rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[11px] uppercase tracking-wide text-neutral-400"
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
