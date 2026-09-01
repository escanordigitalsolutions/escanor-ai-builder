"use client";

import { useCallback, useEffect, useState } from "react";

import { type DesignPage, type PageEntry } from "@/lib/agent/design-pages";

type DesignRow = {
  id: string;
  brief: { name?: string; prompt?: string } | null;
  model: string;
  status: "pending" | "used" | "rejected";
  input_tokens: number;
  output_tokens: number;
  created_at: string;
};

const STATUS_STYLE: Record<string, string> = {
  used: "pill-on",
  rejected: "pill-off",
  pending: "pill-off",
};

const STATUS_LABEL: Record<string, string> = {
  used: "Used",
  rejected: "Rejected",
  pending: "Not used",
};

function fmtDate(iso: string): string {
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

export default function ProjectDesignsPanel({ projectId }: { projectId: string }) {
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openHtml, setOpenHtml] = useState("");
  const [openWhich, setOpenWhich] = useState<DesignPage>("home");
  const [openPages, setOpenPages] = useState<PageEntry[]>([{ slug: "home", label: "Homepage" }]);
  const [openNote, setOpenNote] = useState("");
  const [openLoading, setOpenLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/projects/${projectId}/designs`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.error ?? "Could not load designs.");
      } else {
        setDesigns(json.designs ?? []);
      }
    } catch {
      setErr("Could not load designs.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openPreview(designId: string, which: DesignPage = "home") {
    if (openId === designId && which === openWhich) {
      setOpenId(null);
      setOpenHtml("");
      setOpenNote("");
      return;
    }

    setOpenId(designId);
    setOpenWhich(which);
    setOpenLoading(true);
    setOpenNote("");

    try {
      const res = await fetch(
        `/api/projects/${projectId}/designs/${designId}?which=${which}`
      );
      const json = await res.json();

      if (json.success) {
        setOpenHtml(json.design?.html ?? "");
        setOpenPages((json.available ?? [{ slug: "home", label: "Homepage" }]) as PageEntry[]);
      } else {
        if (Array.isArray(json.available)) setOpenPages(json.available as PageEntry[]);
        // A design from before inner pages were archived has only one screen.
        // Saying so beats an empty frame that looks like a bug.
        setOpenNote(json.error ?? "Could not load the preview.");
        if (which === "inner") setOpenWhich("home");
      }
    } catch {
      setOpenNote("Could not load the preview.");
    } finally {
      setOpenLoading(false);
    }
  }

  async function remove(designId: string) {
    if (!window.confirm("Delete this design from the archive?")) {
      return;
    }
    try {
      const res = await fetch(`/api/projects/${projectId}/designs/${designId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (res.ok && json.success) {
        if (openId === designId) {
          setOpenId(null);
          setOpenHtml("");
        }
        void load();
      } else {
        window.alert(json.error ?? "Could not delete the design.");
      }
    } catch {
      window.alert("Could not delete the design.");
    }
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
          Design archive
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

      {!err && designs.length === 0 && !loading && (
        <p className="mt-3 text-sm text-neutral-500">
          No designs yet — every homepage design generated in the AI Editor will be
          archived here, including the directions you rejected.
        </p>
      )}

      <div className="mt-3 divide-y divide-[rgba(20,18,16,0.06)]">
        {designs.map((d) => (
          <div key={d.id} className="py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className={
                  "rounded-full px-2 py-0.5 text-[10px] font-medium " +
                  (STATUS_STYLE[d.status] ?? "pill-off")
                }
              >
                {STATUS_LABEL[d.status] ?? d.status}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">
                {d.brief?.name || d.brief?.prompt?.slice(0, 60) || "Untitled design"}
              </span>
              <span className="text-[11px] text-neutral-400">
                {d.model} · {fmtDate(d.created_at)}
              </span>
              <button
                onClick={() => void openPreview(d.id, "home")}
                className="btn-ghost px-2.5 py-1 text-[11px]"
              >
                {openId === d.id ? "Close" : "Preview"}
              </button>
              <button
                onClick={() => void remove(d.id)}
                className="rounded-md p-1 text-neutral-300 transition hover:text-red-600"
                title="Delete design"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>
            </div>

            {openId === d.id && (
              <div className="mt-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {openPages.map((page) => (
                    <button
                      key={page.slug}
                      onClick={() => void openPreview(d.id, page.slug)}
                      className={
                        openWhich === page.slug
                          ? "btn-accent px-2.5 py-1 text-[11px] font-medium"
                          : "btn-ghost px-2.5 py-1 text-[11px]"
                      }
                    >
                      {page.label}
                    </button>
                  ))}
                  {openNote ? (
                    <span className="text-[11px] text-neutral-500">{openNote}</span>
                  ) : null}
                </div>

                {openLoading ? (
                  <p className="text-xs text-neutral-400">Loading preview…</p>
                ) : (
                  <iframe
                    srcDoc={openHtml}
                    sandbox="allow-scripts"
                    title="Design preview"
                    className="h-[560px] w-full rounded-xl border border-[rgba(20,18,16,0.1)] bg-white"
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
