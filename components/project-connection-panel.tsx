"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ConnectionData = {
  connected: boolean;
  siteUrl: string;
  bridgeVersion?: string | null;
  wpVersion?: string | null;
  phpVersion?: string | null;
  themeName?: string | null;
  pluginName?: string | null;
  lastConnectedAt?: string | null;
};

export default function ProjectConnectionPanel({
  projectId,
  siteUrl,
  lastConnectedAt,
}: {
  projectId: string;
  siteUrl?: string | null;
  lastConnectedAt?: string | null;
}) {
  const router = useRouter();
  const [connection, setConnection] = useState<ConnectionData | null>(
    siteUrl
      ? {
          connected: true,
          siteUrl,
          lastConnectedAt,
        }
      : null
  );
  const [testing, setTesting] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const resolvedSiteUrl = connection?.siteUrl ?? siteUrl ?? "";
  const wpAdminBridgeUrl = getWpAdminBridgeUrl(resolvedSiteUrl);

  async function testConnection() {
    setTesting(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/connection`, {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Connection test failed.");
      }

      setConnection(data.connection);
      router.refresh();
    } catch (testError) {
      setConnection((current) =>
        current
          ? {
              ...current,
              connected: false,
            }
          : null
      );
      setError(
        testError instanceof Error
          ? testError.message
          : "Connection test failed."
      );
    } finally {
      setTesting(false);
    }
  }

  async function replaceToken() {
    if (!token.trim() || testing) {
      return;
    }

    setTesting(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/connection`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not replace Bridge token.");
      }

      setConnection(data.connection);
      setToken("");
      setEditingToken(false);
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not replace Bridge token."
      );
    } finally {
      setTesting(false);
    }
  }

  const connected = connection?.connected !== false;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">
            WordPress connection
          </p>

          <div className="mt-2 flex items-center gap-2">
            <span
              className={
                connected
                  ? "h-2 w-2 rounded-full bg-green-500"
                  : "h-2 w-2 rounded-full bg-red-500"
              }
            />
            <span className="text-sm text-neutral-900">
              {connected ? "Connected" : "Needs attention"}
            </span>
          </div>

          <p className="mt-2 max-w-md truncate text-xs text-neutral-500">
            {resolvedSiteUrl || "No site URL"}
          </p>

          <p className="mt-1 text-xs text-neutral-600">
            Last checked: {formatDate(connection?.lastConnectedAt ?? lastConnectedAt)}
          </p>

          {connection?.bridgeVersion && (
            <p className="mt-2 text-[11px] text-neutral-500">
              Bridge {connection.bridgeVersion}
              {connection.themeName ? ` · ${connection.themeName}` : ""}
              {connection.pluginName ? ` · ${connection.pluginName}` : ""}
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={testConnection}
            disabled={testing}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-40"
          >
            {testing ? "Checking..." : "Test connection"}
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingToken((current) => !current);
              setError("");
            }}
            disabled={testing}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-40"
          >
            Replace token
          </button>

          {wpAdminBridgeUrl && (
            <a
              href={wpAdminBridgeUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
            >
              WP Admin ↗
            </a>
          )}
        </div>
      </div>

      {editingToken && (
        <div className="mt-5 border-t border-neutral-200 pt-5">
          <label className="block text-xs text-neutral-500">
            New Bridge token
          </label>

          <div className="mt-2 flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste newly generated token"
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
            />

            <button
              type="button"
              onClick={replaceToken}
              disabled={testing || !token.trim()}
              className="rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
            >
              Save
            </button>
          </div>

          <p className="mt-2 text-[11px] text-neutral-600">
            The token is validated against WordPress before the encrypted copy is replaced.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

function getWpAdminBridgeUrl(siteUrl: string) {
  if (!siteUrl) {
    return "";
  }

  try {
    const url = new URL(siteUrl);
    return `${url.origin}/wp-admin/admin.php?page=wp-ai-builder`;
  } catch {
    return "";
  }
}

function formatDate(value?: string | null) {
  if (!value) {
    return "not checked yet";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}
