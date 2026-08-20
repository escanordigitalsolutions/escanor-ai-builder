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
        body: JSON.stringify({
          token,
        }),
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
    <div className="rounded-xl border border-neutral-800 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-600">
            WordPress connection
          </p>

          <div className="mt-2 flex items-center gap-2">
            <span
              className={
                connected
                  ? "h-2 w-2 rounded-full bg-green-400"
                  : "h-2 w-2 rounded-full bg-red-400"
              }
            />
            <span className="text-sm">
              {connected ? "Connected" : "Needs attention"}
            </span>
          </div>

          <p className="mt-2 max-w-md truncate text-xs text-neutral-500">
            {connection?.siteUrl ?? siteUrl ?? "No site URL"}
          </p>

          <p className="mt-1 text-xs text-neutral-600">
            Last checked:{" "}
            {formatDate(connection?.lastConnectedAt ?? lastConnectedAt)}
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={testConnection}
            disabled={testing}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 transition hover:bg-neutral-900 disabled:opacity-40"
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
            className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 transition hover:bg-neutral-900 disabled:opacity-40"
          >
            Replace token
          </button>
        </div>
      </div>

      {editingToken && (
        <div className="mt-5 border-t border-neutral-800 pt-5">
          <label className="block text-xs text-neutral-500">
            New Bridge token
          </label>

          <div className="mt-2 flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste newly generated token"
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm outline-none focus:border-neutral-500"
            />

            <button
              type="button"
              onClick={replaceToken}
              disabled={testing || !token.trim()}
              className="rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40"
            >
              Save
            </button>
          </div>

          <p className="mt-2 text-[11px] text-neutral-600">
            The token is validated against WordPress before the encrypted copy is
            replaced.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950/30 p-3 text-xs text-red-400">
          {error}
        </div>
      )}
    </div>
  );
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
