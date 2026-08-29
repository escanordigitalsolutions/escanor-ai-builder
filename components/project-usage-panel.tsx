"use client";

import { useCallback, useEffect, useState } from "react";

type ModelRow = {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  rateIn: number | null;
  rateOut: number | null;
  costUsd: number | null;
};

type StageRow = {
  stage: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

type UsageData = {
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    costComplete: boolean;
  };
  byModel: ModelRow[];
  byStage: StageRow[];
  lastCallAt: string | null;
};

const STAGE_LABELS: Record<string, string> = {
  concept: "Design concept (cheap)",
  critique: "Design review (cheap)",
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

function money(n: number | null): string {
  if (n == null) return "—";
  return "$" + (n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2));
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
          AI usage & prices
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
              label={data.totals.costComplete ? "Cost" : "Cost (partial)"}
              value={money(data.totals.costUsd)}
            />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-neutral-700">
              By model — rates are USD per 1M tokens
            </p>
            {data.byModel.length === 0 ? (
              <p className="text-xs text-neutral-400">No calls yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-neutral-400">
                      <th className="pb-1 font-normal">Model</th>
                      <th className="pb-1 text-right font-normal">Calls</th>
                      <th className="pb-1 text-right font-normal">In</th>
                      <th className="pb-1 text-right font-normal">Out</th>
                      <th className="pb-1 text-right font-normal">$/1M in</th>
                      <th className="pb-1 text-right font-normal">$/1M out</th>
                      <th className="pb-1 text-right font-normal">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="text-neutral-700">
                    {data.byModel.map((m) => (
                      <tr key={m.model} className="border-t border-[rgba(20,18,16,0.06)]">
                        <td className="max-w-[180px] truncate py-1.5 pr-2">{m.model}</td>
                        <td className="py-1.5 text-right">{m.calls}</td>
                        <td className="py-1.5 text-right">{fmt(m.inputTokens)}</td>
                        <td className="py-1.5 text-right">{fmt(m.outputTokens)}</td>
                        <td className="py-1.5 text-right">
                          {m.rateIn != null ? "$" + m.rateIn : "—"}
                        </td>
                        <td className="py-1.5 text-right">
                          {m.rateOut != null ? "$" + m.rateOut : "—"}
                        </td>
                        <td className="py-1.5 text-right font-medium">{money(m.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-neutral-700">By stage</p>
            {data.byStage.length === 0 ? (
              <p className="text-xs text-neutral-400">No calls yet.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-neutral-400">
                    <th className="pb-1 font-normal">Stage</th>
                    <th className="pb-1 text-right font-normal">Calls</th>
                    <th className="pb-1 text-right font-normal">In</th>
                    <th className="pb-1 text-right font-normal">Out</th>
                    <th className="pb-1 text-right font-normal">Cost</th>
                  </tr>
                </thead>
                <tbody className="text-neutral-700">
                  {data.byStage.map((s) => (
                    <tr key={s.stage} className="border-t border-[rgba(20,18,16,0.06)]">
                      <td className="py-1.5 pr-2">{STAGE_LABELS[s.stage] ?? s.stage}</td>
                      <td className="py-1.5 text-right">{s.calls}</td>
                      <td className="py-1.5 text-right">{fmt(s.inputTokens)}</td>
                      <td className="py-1.5 text-right">{fmt(s.outputTokens)}</td>
                      <td className="py-1.5 text-right font-medium">{money(s.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!data.totals.costComplete && (
            <p className="mt-3 text-[11px] text-neutral-400">
              “—” rows have no price configured — add them to OPENAI_PRICING to complete the total.
            </p>
          )}
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
