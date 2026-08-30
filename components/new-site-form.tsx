"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Add a site.
 *
 * This used to ask for the site's address and a bridge token the customer had
 * to go and fetch from WordPress first — which meant the form could not be
 * filled in until the plugin was already installed and configured. Now it asks
 * for a name, and hands back the one key that finishes the job from the other
 * side.
 */
export default function NewSiteForm() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState("");
  const [siteKey, setSiteKey] = useState("");
  const [copied, setCopied] = useState(false);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setDetail("");

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        siteKey?: string;
        error?: string;
        detail?: string;
      };

      if (data.success && data.siteKey) {
        setSiteKey(data.siteKey);
        router.refresh();
      } else {
        setError(data.error ?? "Could not create the site.");
        setDetail(`HTTP ${response.status}${data.detail ? ` · ${data.detail}` : ""}`);
      }
    } catch (e) {
      setError("Could not reach Meikero.");
      setDetail(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }

    setLoading(false);
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(siteKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function close() {
    setOpen(false);
    setName("");
    setSiteKey("");
    setError("");
    setDetail("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-accent px-4 py-2.5 text-sm font-medium"
      >
        + New site
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/25 p-6 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg bg-white/95 p-7">
        {siteKey ? (
          <>
            <h2 className="text-[1.15rem] font-semibold tracking-tight text-neutral-900">
              Copy your site key
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              Paste this into <strong>Meikero → Cloud connection</strong> in
              your WordPress admin. That is the whole connection — nothing comes
              back the other way.
            </p>

            <div className="mt-5 rounded-xl border border-neutral-900/[0.09] bg-white/70 p-3">
              <code className="block break-all font-mono text-[12px] leading-relaxed text-neutral-800">
                {siteKey}
              </code>
            </div>

            <p className="mt-3 rounded-lg bg-amber-50/80 px-3.5 py-2.5 text-[0.85rem] text-amber-900">
              Shown once. If you lose it, create a new key from the site&rsquo;s
              page — the old one stops working.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={copyKey}
                className="btn-accent px-4 py-2.5 text-sm font-medium"
              >
                {copied ? "Copied" : "Copy key"}
              </button>
              <a
                href="/plugin/meikero-bridge.zip"
                download
                className="btn-ghost px-4 py-2.5 text-sm font-medium"
              >
                Download the plugin
              </a>
              <button
                type="button"
                onClick={close}
                className="ml-auto text-sm text-neutral-500 hover:text-neutral-900"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={createProject}>
            <h2 className="text-[1.15rem] font-semibold tracking-tight text-neutral-900">
              Add a site
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              Just a name for now. Meikero picks up the address and the
              WordPress details from the plugin when you connect it.
            </p>

            <label
              className="mb-2 mt-5 block text-sm font-medium text-neutral-700"
              htmlFor="site-name"
            >
              Site name
            </label>
            <input
              id="site-name"
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Moss Club"
              className="field px-4 py-2.5 text-[0.95rem]"
            />

            {error ? (
              <div className="mt-4 rounded-lg bg-red-50 px-3.5 py-2.5">
                <p className="text-sm text-red-700">{error}</p>
                {detail ? (
                  <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-red-900/70">
                    {detail}
                  </pre>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 flex items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className="btn-accent px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {loading ? "Creating…" : "Create site"}
              </button>
              <button
                type="button"
                onClick={close}
                className="text-sm text-neutral-500 hover:text-neutral-900"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
