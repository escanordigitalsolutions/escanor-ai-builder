"use client";

import { useState } from "react";

import type { AdminDesignRow } from "@/lib/admin/designs";

type Loaded = {
  html: string;
  which: "home" | "inner";
  hasInner: boolean;
  critique: string | null;
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * The design archive.
 *
 * Built to answer one question that could not be answered before: did that
 * prompt change make the output better? So the list shows what each run was
 * *asked* to be — the concept, the signature move, the typefaces, the accent —
 * next to what the validator found, and the preview shows what came out.
 */
export default function AdminDesigns({ designs }: { designs: AdminDesignRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [which, setWhich] = useState<"home" | "inner">("home");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  /**
   * Fetching happens on the click, not in an effect.
   *
   * Loading a design is a response to someone pressing a button, not a
   * consequence of rendering — and an effect that begins by clearing three
   * pieces of state re-renders twice before the request even leaves.
   */
  async function open(id: string, page: "home" | "inner") {
    setOpenId(id);
    setWhich(page);
    setBusy(true);
    setError("");
    setLoaded(null);

    try {
      const res = await fetch(`/api/admin/designs/${id}?which=${page}`);
      const data = await res.json();

      if (!data.success) {
        setError(data.detail ? `${data.error} — ${data.detail}` : data.error);
        return;
      }

      setLoaded({
        html: data.html ?? "",
        which: data.which,
        hasInner: Boolean(data.hasInner),
        critique: data.critique ?? null,
      });
    } catch {
      setError("Could not load the design.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpenId(null);
    setLoaded(null);
    setError("");
  }

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? designs.filter((d) =>
        [d.project, d.owner, d.concept, d.shape, d.model, d.fonts]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))
      )
    : designs;

  return (
    <>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by site, account, concept, shape or typeface"
        className="field mb-4 max-w-md px-4 py-2.5 text-[0.92rem]"
      />

      <div className="flex flex-col gap-2">
        {shown.map((d) => {
          const isOpen = openId === d.id;

          return (
            <div key={d.id} className="glass-card overflow-hidden">
              <button
                onClick={() => (isOpen ? close() : void open(d.id, "home"))}
                className="flex w-full items-start gap-4 px-5 py-4 text-left transition hover:bg-neutral-900/[0.02]"
              >
                <span
                  aria-hidden
                  className="mt-1 h-8 w-8 flex-none rounded-md border border-neutral-900/10"
                  style={{ background: d.accent || "#e5e5e5" }}
                />

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <strong className="text-[0.98rem] font-semibold text-neutral-900">
                      {d.concept || "(no concept)"}
                    </strong>
                    {d.shape ? (
                      <span className="rounded bg-neutral-900/[0.06] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                        {d.shape}
                      </span>
                    ) : null}
                    {d.retried ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-800">
                        retried
                      </span>
                    ) : null}
                    {d.fatal > 0 ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-700">
                        {d.fatal} fatal
                      </span>
                    ) : d.failures > 0 ? (
                      <span className="rounded bg-neutral-900/[0.06] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                        {d.failures} soft
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-700">
                        clean
                      </span>
                    )}
                    {d.hasInner ? null : (
                      <span className="rounded bg-neutral-900/[0.06] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                        no inner page
                      </span>
                    )}
                  </span>

                  {d.signatureMove ? (
                    <span className="mt-1 block truncate text-[0.86rem] text-neutral-600">
                      {d.signatureMove}
                    </span>
                  ) : null}

                  <span className="mt-1.5 block text-xs text-neutral-500">
                    {d.project} · {d.owner || "unknown account"} · {d.fonts || "no fonts recorded"}
                  </span>
                </span>

                <span className="flex-none text-right text-xs text-neutral-500">
                  <span className="block">{fmt(d.createdAt)}</span>
                  <span className="block font-mono">{d.model}</span>
                  <span className="block font-mono">
                    {Math.round(d.chars / 1000)}k chars
                  </span>
                </span>
              </button>

              {isOpen ? (
                <div className="border-t border-neutral-900/10 bg-neutral-900/[0.02] p-5">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void open(d.id, "home")}
                      className={
                        which === "home"
                          ? "btn-accent px-3 py-1.5 text-xs font-medium"
                          : "btn-ghost px-3 py-1.5 text-xs"
                      }
                    >
                      Homepage
                    </button>
                    <button
                      onClick={() => void open(d.id, "inner")}
                      disabled={!d.hasInner}
                      className={
                        which === "inner"
                          ? "btn-accent px-3 py-1.5 text-xs font-medium"
                          : "btn-ghost px-3 py-1.5 text-xs disabled:opacity-40"
                      }
                    >
                      Inner page
                    </button>

                    {d.outputTokens ? (
                      <span className="ml-auto font-mono text-[11px] text-neutral-500">
                        {d.inputTokens ?? 0} in · {d.outputTokens} out
                      </span>
                    ) : null}
                  </div>

                  {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

                  {loaded?.critique ? (
                    <p className="mb-3 max-w-prose text-[0.88rem] leading-relaxed text-neutral-600">
                      {loaded.critique}
                    </p>
                  ) : null}

                  <div className="overflow-hidden rounded-xl border border-neutral-900/10 bg-white">
                    {busy ? (
                      <div className="flex h-[420px] items-center justify-center text-sm text-neutral-500">
                        Loading…
                      </div>
                    ) : loaded?.html ? (
                      <iframe
                        // sandbox without allow-scripts: an archived page is
                        // untrusted markup, and nothing here needs it to run.
                        sandbox=""
                        srcDoc={loaded.html}
                        title={`${d.concept ?? "Design"} — ${which}`}
                        className="h-[620px] w-full border-0 bg-white"
                      />
                    ) : (
                      <div className="flex h-[420px] items-center justify-center text-sm text-neutral-500">
                        Nothing to show.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {shown.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-sm text-neutral-500">
              {designs.length
                ? "No design matches that search."
                : "No designs have been generated yet."}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
