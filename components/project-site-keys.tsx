"use client";

import { useEffect, useState } from "react";

type SiteKey = {
  id: string;
  label: string;
  masked: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  lastActorLogin: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export default function ProjectSiteKeys({
  projectId,
}: {
  projectId: string;
}) {
  const [keys, setKeys] = useState<SiteKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Held in memory only. The server never returns it again.
  const [freshKey, setFreshKey] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void loadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function loadKeys() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/api-keys`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not load site keys.");
      }

      setKeys(data.keys);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load site keys."
      );
    } finally {
      setLoading(false);
    }
  }

  async function createKey() {
    setCreating(true);
    setError("");
    setFreshKey("");
    setCopied(false);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/api-keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "WordPress plugin" }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not create the site key.");
      }

      setFreshKey(data.plaintext);
      await loadKeys();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create the site key."
      );
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(keyId: string) {
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/api-keys/${keyId}`,
        { method: "DELETE" }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not revoke the site key.");
      }

      await loadKeys();
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "Could not revoke the site key."
      );
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(freshKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">
            Site keys
          </p>

          <p className="mt-2 text-sm text-neutral-700">
            Let the WordPress plugin call the builder directly
          </p>
        </div>

        <button
          type="button"
          onClick={createKey}
          disabled={creating}
          className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
        >
          {creating ? "Creating..." : "New key"}
        </button>
      </div>

      {freshKey && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] uppercase tracking-wide text-amber-600">
            Copy this now — it is shown once
          </p>

          <p className="mt-3 break-all font-mono text-xs text-amber-900">
            {freshKey}
          </p>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={copyKey}
              className="rounded-md border border-amber-300 px-2.5 py-1.5 text-xs text-amber-700 hover:bg-amber-100"
            >
              {copied ? "Copied" : "Copy"}
            </button>

            <button
              type="button"
              onClick={() => setFreshKey("")}
              className="text-xs text-neutral-500 hover:text-neutral-700"
            >
              Dismiss
            </button>
          </div>

          <p className="mt-3 text-[11px] text-neutral-500">
            Paste it into <span className="text-neutral-700">
              WordPress → AI Builder → Cloud connection
            </span>.
          </p>
        </div>
      )}

      {loading && (
        <p className="mt-5 text-xs text-neutral-600">Loading site keys...</p>
      )}

      {!loading && keys.length === 0 && (
        <p className="mt-5 text-xs text-neutral-600">
          No site keys yet. Create one to connect the WordPress plugin.
        </p>
      )}

      {!loading && keys.length > 0 && (
        <ul className="mt-5 divide-y divide-neutral-200 border-t border-neutral-200">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-neutral-700">
                  {key.masked}
                </p>

                <p className="mt-1 text-[11px] text-neutral-600">
                  {key.revokedAt
                    ? `Revoked ${formatDate(key.revokedAt)}`
                    : key.lastUsedAt
                      ? `Last used ${formatDate(key.lastUsedAt)}${
                          key.lastActorLogin ? ` by ${key.lastActorLogin}` : ""
                        }`
                      : "Never used"}
                </p>
              </div>

              {!key.revokedAt && (
                <button
                  type="button"
                  onClick={() => revokeKey(key.id)}
                  className="shrink-0 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
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
