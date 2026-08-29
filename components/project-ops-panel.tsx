"use client";

import { useCallback, useEffect, useState } from "react";

type Op = {
  id: string;
  at: string;
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  meta: Record<string, unknown> | null;
};

const STAGE_LABELS: Record<string, string> = {
  editplan: "Edit plan",
  concept: "Concept",
  critique: "Design review",
  design: "Design",
  plan: "Page plan",
  build: "Build",
  edit: "Edit",
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

function when(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ProjectOpsPanel({ projectId }: { projectId: string }) {
  const [ops, setOps] = useState<Op[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/projects/${projectId}/ops?limit=60`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.error ?? "Could not load operations.");
      } else {
        setOps(json.ops ?? []);
      }
    } catch {
      setErr("Could not load operations.");
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
          Operations log
        </p>
        <button
          onClick={() => void load()}
          className="btn-ghost px-3 py-1 text-xs"
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Every AI call with its debug detail — click a row to see the prompt, files and steps behind it.
      </p>

      {err && <p className="mt-3 text-sm text-red-500">{err}</p>}

      {!err && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-neutral-400">
                <th className="pb-1 font-normal">When</th>
                <th className="pb-1 font-normal">Stage</th>
                <th className="pb-1 font-normal">Model</th>
                <th className="pb-1 text-right font-normal">In</th>
                <th className="pb-1 text-right font-normal">Out</th>
                <th className="pb-1 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody className="text-neutral-700">
              {ops.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="py-3 text-neutral-400">
                    No operations yet.
                  </td>
                </tr>
              )}
              {ops.map((op) => (
                <OpRow
                  key={op.id}
                  op={op}
                  open={open === op.id}
                  onToggle={() => setOpen(open === op.id ? null : op.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OpRow({
  op,
  open,
  onToggle,
}: {
  op: Op;
  open: boolean;
  onToggle: () => void;
}) {
  const hasMeta = op.meta && Object.keys(op.meta).length > 0;
  return (
    <>
      <tr
        className={
          "border-t border-[rgba(20,18,16,0.06)] " +
          (hasMeta ? "cursor-pointer hover:bg-[rgba(20,18,16,0.03)]" : "")
        }
        onClick={hasMeta ? onToggle : undefined}
      >
        <td className="whitespace-nowrap py-1.5 pr-2">{when(op.at)}</td>
        <td className="py-1.5 pr-2">
          {STAGE_LABELS[op.stage] ?? op.stage}
          {hasMeta && <span className="ml-1 text-neutral-400">{open ? "▾" : "▸"}</span>}
        </td>
        <td className="max-w-[160px] truncate py-1.5 pr-2">{op.model}</td>
        <td className="py-1.5 text-right">{fmt(op.inputTokens)}</td>
        <td className="py-1.5 text-right">{fmt(op.outputTokens)}</td>
        <td className="py-1.5 text-right font-medium">{money(op.costUsd)}</td>
      </tr>
      {open && hasMeta && (
        <tr className="border-t border-[rgba(20,18,16,0.04)] bg-[rgba(20,18,16,0.02)]">
          <td colSpan={6} className="px-2 py-2">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-neutral-600">
              {JSON.stringify(op.meta, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
