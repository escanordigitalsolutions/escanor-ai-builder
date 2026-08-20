"use client";

import { useEffect, useState } from "react";

type Usage = {
  conversations: number;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCalls: number;
  lastRunAt: string | null;
  models: Record<string, number>;
};

export default function ProjectUsageSummary({
  projectId,
}: {
  projectId: string;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function loadUsage() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/usage`, {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not load AI usage.");
      }

      setUsage(data.usage);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load usage."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-600">
            AI usage
          </p>
          <p className="mt-2 text-sm text-neutral-300">
            Project-level usage totals
          </p>
        </div>

        <button
          type="button"
          onClick={loadUsage}
          disabled={loading}
          className="rounded-md border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-500 hover:text-white disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      {loading && (
        <p className="mt-5 text-xs text-neutral-600">Loading usage...</p>
      )}

      {!loading && usage && (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Chats" value={usage.conversations.toLocaleString()} />
          <Metric label="AI runs" value={usage.runs.toLocaleString()} />
          <Metric label="Tokens" value={usage.totalTokens.toLocaleString()} />
          <Metric label="Tool calls" value={usage.toolCalls.toLocaleString()} />
        </div>
      )}

      {!loading && usage && (
        <div className="mt-4 border-t border-neutral-800 pt-4 text-[11px] text-neutral-600">
          Input {usage.inputTokens.toLocaleString()} · Output{" "}
          {usage.outputTokens.toLocaleString()}
          {usage.lastRunAt ? ` · Last run ${formatDate(usage.lastRunAt)}` : ""}
        </div>
      )}

      {error && (
        <p className="mt-4 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-neutral-600">{label}</p>
      <p className="mt-1 text-lg font-medium text-white">{value}</p>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}
