"use client";

import { useEffect, useState } from "react";

/**
 * Modules & plan — the manual licensing control for one project.
 *
 * Toggling a module here writes to projects.modules; the wp-admin plugin picks
 * it up on its next session handshake and locks or unlocks the matching card.
 * Content is the base module and is always on, shown but not switchable.
 */

type ModuleKey = "content" | "seo" | "health" | "build";

type Modules = Record<ModuleKey, boolean>;

const MODULE_META: {
  key: ModuleKey;
  title: string;
  desc: string;
  base?: boolean;
}[] = [
  {
    key: "content",
    title: "Content",
    desc: "Chat + create and edit pages, posts and products. The base module.",
    base: true,
  },
  {
    key: "seo",
    title: "SEO",
    desc: "Titles, meta and headings written into the site's SEO plugin.",
  },
  {
    key: "health",
    title: "Health",
    desc: "Site checks with one-click fixes the AI can apply and roll back.",
  },
  {
    key: "build",
    title: "Build",
    desc: "Theme and block code generation, diff review, deploy and rollback.",
  },
];

const PLANS = ["free", "starter", "pro", "agency"];

export default function ProjectModules({ projectId }: { projectId: string }) {
  const [modules, setModules] = useState<Modules>({
    content: true,
    seo: true,
    health: true,
    build: true,
  });
  const [plan, setPlan] = useState("free");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/modules`, {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not load modules.");
      }

      setModules(data.modules);
      setPlan(data.plan);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load modules."
      );
    } finally {
      setLoading(false);
    }
  }

  function toggle(key: ModuleKey) {
    if (key === "content") {
      return;
    }

    setSaved(false);
    setModules((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const response = await fetch(`/api/projects/${projectId}/modules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules, plan }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not save modules.");
      }

      setModules(data.modules);
      setPlan(data.plan);
      setSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save modules."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">
            Modules &amp; plan
          </p>

          <p className="mt-2 text-sm text-neutral-700">
            What this project is licensed for. The WordPress plugin locks the rest.
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Plan
          <select
            value={plan}
            onChange={(event) => {
              setSaved(false);
              setPlan(event.target.value);
            }}
            className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-800"
          >
            {PLANS.map((option) => (
              <option key={option} value={option}>
                {option[0].toUpperCase() + option.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="mt-5 text-xs text-neutral-600">Loading modules...</p>
      ) : (
        <ul className="mt-5 divide-y divide-neutral-200 border-t border-neutral-200">
          {MODULE_META.map((meta) => {
            const on = Boolean(modules[meta.key]);

            return (
              <li
                key={meta.key}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900">
                    {meta.title}
                    {meta.base && (
                      <span className="ml-2 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-neutral-500">
                        Base
                      </span>
                    )}
                  </p>

                  <p className="mt-0.5 text-xs text-neutral-500">{meta.desc}</p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`Toggle ${meta.title}`}
                  disabled={meta.base}
                  onClick={() => toggle(meta.key)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                    on ? "bg-neutral-900" : "bg-neutral-300"
                  } ${meta.base ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      on ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || loading}
          className="rounded-md bg-neutral-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>

        {saved && <span className="text-xs text-emerald-600">Saved</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
