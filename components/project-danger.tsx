"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ProjectDanger({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function remove() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErr(data.error ?? "Could not delete the project.");
        setBusy(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setErr("Could not delete the project.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 flex items-center justify-end gap-3 text-sm">
      {err && <span className="text-xs text-red-500">{err}</span>}
      {arming ? (
        <>
          <span className="text-xs text-neutral-500">
            Delete “{projectName}” and all its data? This cannot be undone.
          </span>
          <button
            onClick={() => setArming(false)}
            disabled={busy}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => void remove()}
            disabled={busy}
            className="rounded-[10px] bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? "Deleting…" : "Yes, delete project"}
          </button>
        </>
      ) : (
        <button
          onClick={() => setArming(true)}
          className="text-xs text-neutral-400 underline-offset-2 transition hover:text-red-600 hover:underline"
        >
          Delete project
        </button>
      )}
    </div>
  );
}
