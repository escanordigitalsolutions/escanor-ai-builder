"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function NewProjectPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState(
    "https://sistema.escanor.lt"
  );
  const [token, setToken] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function createProject(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/projects", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          name,
          siteUrl,
          token,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error ?? "Could not create project.");
        setLoading(false);
        return;
      }

      router.push(`/dashboard/projects/${data.project.id}`);
    } catch {
      setError("Could not connect to the server.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f6f7] text-neutral-900 p-8">
      <div className="max-w-xl mx-auto">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-neutral-500 mb-8"
        >
          ← Projects
        </button>

        <h1 className="text-2xl font-semibold tracking-tight">
          New WordPress Project
        </h1>

        <p className="text-neutral-500 mt-2 mb-10">
          Connect an existing WordPress installation.
        </p>

        <form
          onSubmit={createProject}
          className="space-y-6"
        >
          <div>
            <label className="block text-sm mb-2">
              Project name
            </label>

            <input
              required
              value={name}
              onChange={(e) =>
                setName(e.target.value)
              }
              placeholder="MEIKERO Test"
              className="w-full bg-white border border-neutral-200 rounded-lg px-4 py-3 text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400"
            />
          </div>

          <div>
            <label className="block text-sm mb-2">
              WordPress URL
            </label>

            <input
              required
              type="url"
              value={siteUrl}
              onChange={(e) =>
                setSiteUrl(e.target.value)
              }
              className="w-full bg-white border border-neutral-200 rounded-lg px-4 py-3 text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400"
            />
          </div>

          <div>
            <label className="block text-sm mb-2">
              Bridge token
            </label>

            <input
              required
              type="password"
              value={token}
              onChange={(e) =>
                setToken(e.target.value)
              }
              placeholder="Paste connection token"
              className="w-full bg-white border border-neutral-200 rounded-lg px-4 py-3 text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400"
            />

            <p className="text-xs text-neutral-500 mt-2">
              The token is encrypted before being stored.
            </p>
          </div>

          {error && (
            <div className="border border-red-200 bg-red-50 rounded-lg p-4 text-red-600 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-neutral-900 text-white rounded-lg py-3 font-medium hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading
              ? "Connecting WordPress..."
              : "Create Project"}
          </button>
        </form>
      </div>
    </main>
  );
}
