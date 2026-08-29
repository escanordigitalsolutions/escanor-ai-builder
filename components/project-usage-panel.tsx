"use client";

import { useCallback, useEffect, useState } from "react";

type Bucket = { calls: number; inputTokens: number; outputTokens: number };

type UsageData = {
  totals: Bucket;
  byModel: Record<string, Bucket>;
  byStage: Record<string, Bucket>;
  estimatedCostUsd: number | null;
  costComplete: boolean;
  lastCallAt: string | null;
};

const STAGE_LABELS: Record<string, string> = {
  design: "Design (mockup)",
  plan: "Page plan",
  build: "File generation",
  edit: "Edits",
  chat: "Chat",
  review: "Quality check",
};

function fmt(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export default function ProjectUsagePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/projects/${projectId}/usage`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.error ?? "Could not load usage.");
      } else {
        setData(json);
      }
    } catch {
      setErr("Could not load usage.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6366f1]">
          AI usage
        </p>
        <button
          onClick={() => void load()}
          className="btn-ghost px-3 py-1 text-xs"
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {err && <p className="mt-3 text-sm text-red-500">{err}</p>}

      {data && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Calls" value={fmt(data.totals.calls)} />
            <Stat label="Input tokens" value={fmt(data.totals.inputTokens)} />
            <Stat label="Output tokens" value={fmt(data.totals.outputTokens)} />
            <Stat
              label={data.costComplete ? "Est. cost" : "Est. cost (partial)"}
              value={
                data.estimatedCostUsd != null
                  ? "$" + data.estimatedCostUsd.toFixed(2)
                  : "—"
              }
            />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <BucketTable title="By model" rows={data.byModel} />
            <BucketTable
              title="By stage"
              rows={data.byStage}
              labels={STAGE_LABELS}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-soft rounded-xl p-3">
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function BucketTable({
  title,
  rows,
  labels,
}: {
  title: string;
  rows: Record<string, Bucket>;
  labels?: Record<string, string>;
}) {
  const entries = Object.entries(rows).sort(
    (a, b) => b[1].inputTokens + b[1].outputTokens - (a[1].inputTokens + a[1].outputTokens)
  );

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-neutral-700">{title}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-neutral-400">No calls yet.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-neutral-400">
              <th className="pb-1 font-normal">&nbsp;</th>
              <th className="pb-1 text-right font-normal">Calls</th>
              <th className="pb-1 text-right font-normal">In</th>
              <th className="pb-1 text-right font-normal">Out</th>
            </tr>
          </thead>
          <tbody className="text-neutral-700">
            {entries.map(([key, b]) => (
              <tr key={key} className="border-t border-[rgba(20,18,16,0.06)]">
                <td className="py-1.5 pr-2">{labels?.[key] ?? key}</td>
                <td className="py-1.5 text-right">{b.calls}</td>
                <td className="py-1.5 text-right">{fmt(b.inputTokens)}</td>
                <td className="py-1.5 text-right">{fmt(b.outputTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
