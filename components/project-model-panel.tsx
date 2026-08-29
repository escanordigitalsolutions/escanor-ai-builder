"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Tier = "plan" | "build" | "edit" | "chat" | "review";
type Cfg = Partial<Record<Tier, string>>;

const TIERS: { key: Tier; label: string; hint: string }[] = [
  {
    key: "plan",
    label: "Blueprint & design plan",
    hint: "The creative step — pick your STRONGEST model here. Empty = same as file generation.",
  },
  {
    key: "build",
    label: "File generation",
    hint: "Writes the theme files from the blueprint — a fast, cheap model does fine.",
  },
  { key: "edit", label: "Edits & design", hint: "Chat edits + design elevation. A strong model pays off here too." },
  { key: "chat", label: "Chat", hint: "AI Editor conversation — fast model recommended." },
  { key: "review", label: "Quality check", hint: "Correctness review pass." },
];

const SUGGESTIONS = [
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
  "claude-sonnet-5",
];

export default function ProjectModelPanel({
  projectId,
  initial,
}: {
  projectId: string;
  initial: Cfg;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<Cfg>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`/api/projects/${projectId}/models`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelConfig: cfg }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMsg(data.error ?? "Could not save.");
      } else {
        setMsg("Saved");
        router.refresh();
      }
    } catch {
      setMsg("Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-card p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6366f1]">
        Models
      </p>
      <p className="mt-2 text-sm text-neutral-600">
        Choose the AI model for each task. Leave a field blank to use the default. A
        Claude model id (starts with “claude”) runs on your Anthropic key.
      </p>

      <div className="mt-4 space-y-3">
        {TIERS.map((t) => (
          <div key={t.key}>
            <label className="mb-1 flex items-center gap-2 text-xs font-medium text-neutral-700">
              {t.label}
            </label>
            <input
              list="wpab-model-suggestions"
              className="field px-3 py-2 text-sm"
              placeholder="default"
              value={cfg[t.key] ?? ""}
              onChange={(e) => setCfg((c) => ({ ...c, [t.key]: e.target.value }))}
            />
            <p className="mt-1 text-[11px] text-neutral-500">{t.hint}</p>
          </div>
        ))}
        <datalist id="wpab-model-suggestions">
          {SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="btn-accent px-4 py-2 text-sm font-medium"
        >
          {saving ? "Saving…" : "Save models"}
        </button>
        {msg && <span className="text-xs text-neutral-500">{msg}</span>}
      </div>
    </div>
  );
}
