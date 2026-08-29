"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** The small per-card delete control on the main dashboard. */
export default function DashboardCardActions({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!window.confirm(`Delete “${projectName}” and all its data? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        window.alert(data.error ?? "Could not delete the project.");
      } else {
        router.refresh();
      }
    } catch {
      window.alert("Could not delete the project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      title="Delete project"
      aria-label={`Delete ${projectName}`}
      className="rounded-md p-1.5 text-neutral-300 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      </svg>
    </button>
  );
}
