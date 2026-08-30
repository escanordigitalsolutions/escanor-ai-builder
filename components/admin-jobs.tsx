"use client";

import { useState } from "react";

import type { AdminJobRow } from "@/lib/admin/jobs";

const STATUS_STYLE: Record<string, string> = {
  done: "bg-emerald-100 text-emerald-700",
  running: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-700",
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function secs(ms: number | null): string {
  return ms === null ? "—" : `${Math.round(ms / 1000)}s`;
}

/**
 * The operations log.
 *
 * One row per generation, ordered newest first, showing the thing that is
 * actually asked after a failure: how far it got, what it said, how long it
 * ran, and whether the person was left out of pocket.
 */
export default function AdminJobs({ jobs }: { jobs: AdminJobRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [only, setOnly] = useState<"all" | "error" | "running">("all");

  const shown = jobs.filter((j) => {
    if (only === "all") return true;
    return j.status === only;
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "error", "running"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setOnly(key)}
            className={
              only === key
                ? "btn-accent px-3 py-1.5 text-xs font-medium capitalize"
                : "btn-ghost px-3 py-1.5 text-xs capitalize"
            }
          >
            {key === "all" ? `All ${jobs.length}` : key}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((j) => {
          const isOpen = openId === j.id;
          const lost = j.charged > 0 && j.refunded === 0 && j.status === "error";

          return (
            <div key={j.id} className="glass-card overflow-hidden">
              <button
                onClick={() => setOpenId(isOpen ? null : j.id)}
                className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition hover:bg-neutral-900/[0.02]"
              >
                <span
                  className={`mt-0.5 flex-none rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                    STATUS_STYLE[j.status] ?? "bg-neutral-900/[0.06] text-neutral-500"
                  }`}
                >
                  {j.status}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <strong className="text-[0.94rem] font-semibold text-neutral-900">
                      {j.kind}
                    </strong>
                    {j.stage ? (
                      <span className="font-mono text-[11px] text-neutral-500">
                        stage: {j.stage}
                      </span>
                    ) : null}
                    {j.hasResult ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-700">
                        output kept
                      </span>
                    ) : null}
                    {lost ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-700">
                        charged, not refunded
                      </span>
                    ) : null}
                  </span>

                  {j.error ? (
                    <span className="mt-1 block truncate text-[0.85rem] text-red-700">
                      {j.error}
                    </span>
                  ) : j.note ? (
                    <span className="mt-1 block truncate text-[0.85rem] text-neutral-600">
                      {j.note}
                    </span>
                  ) : null}

                  <span className="mt-1 block text-xs text-neutral-500">
                    {j.project} · {j.owner || "unknown account"} · {fmt(j.createdAt)}
                  </span>
                </span>

                <span className="flex-none text-right text-xs text-neutral-500">
                  <span className="block font-mono tabular-nums">
                    {j.seconds === null ? "—" : `${j.seconds}s`}
                  </span>
                  <span className="block font-mono tabular-nums">
                    −{j.charged}
                    {j.refunded > 0 ? ` +${j.refunded}` : ""}
                  </span>
                </span>
              </button>

              {isOpen ? (
                <div className="border-t border-neutral-900/10 bg-neutral-900/[0.02] px-5 py-4">
                  {j.error ? (
                    <pre className="mb-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-red-900">
                      {j.error}
                    </pre>
                  ) : null}

                  {j.usage.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-left text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-neutral-400">
                            <th className="pb-2 pr-4 font-medium">Stage</th>
                            <th className="pb-2 pr-4 font-medium">Model</th>
                            <th className="pb-2 pr-4 font-medium">Took</th>
                            <th className="pb-2 pr-4 font-medium">In</th>
                            <th className="pb-2 font-medium">Out</th>
                          </tr>
                        </thead>
                        <tbody className="tabular-nums">
                          {j.usage.map((u, i) => (
                            <tr key={i} className="border-t border-neutral-900/[0.07]">
                              <td className="py-1.5 pr-4 text-neutral-900">{u.stage}</td>
                              <td className="py-1.5 pr-4 font-mono text-neutral-600">
                                {u.model}
                              </td>
                              <td className="py-1.5 pr-4 font-mono text-neutral-600">
                                {secs(u.ms)}
                              </td>
                              <td className="py-1.5 pr-4 font-mono text-neutral-600">
                                {u.inputTokens}
                              </td>
                              <td className="py-1.5 font-mono text-neutral-600">
                                {u.outputTokens}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-500">
                      No model calls were recorded for this job — it failed before the
                      first one returned.
                    </p>
                  )}

                  <p className="mt-3 font-mono text-[11px] text-neutral-400">{j.id}</p>
                </div>
              ) : null}
            </div>
          );
        })}

        {shown.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-sm text-neutral-500">Nothing here.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
