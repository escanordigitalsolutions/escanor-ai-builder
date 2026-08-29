"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function NewSiteForm() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, siteUrl, token }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error ?? "Could not create the site.");
        setLoading(false);
        return;
      }

      router.push(`/dashboard/projects/${data.project.id}`);
    } catch {
      setError("Could not connect to the server.");
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-accent px-4 py-2 text-sm font-medium"
      >
        + New site
      </button>
    );
  }

  return (
    <div className="glass-card w-full p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-neutral-900">
          Connect a WordPress site
        </h2>
        <button
          onClick={() => setOpen(false)}
          className="text-sm text-neutral-500 transition hover:text-neutral-900"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={createProject} className="mt-4 space-y-4">
        <div>
          <label className="mb-1 block text-sm text-neutral-600">Site name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My site"
            className="field px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-neutral-600">
            WordPress URL
          </label>
          <input
            required
            type="url"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://example.com"
            className="field px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-neutral-600">
            Bridge token
          </label>
          <input
            required
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste the bridge token from WordPress"
            className="field px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Generate it in WordPress under Meikero → Bridge settings. It is
            encrypted before being stored.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-accent px-4 py-2 text-sm font-medium"
        >
          {loading ? "Connecting…" : "Connect site"}
        </button>
      </form>
    </div>
  );
}
