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
    <main className="min-h-screen bg-neutral-950 text-white p-10">
      <div className="max-w-xl mx-auto">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-neutral-500 mb-8"
        >
          ← Projects
        </button>

        <h1 className="text-3xl font-semibold">
          New WordPress Project
        </h1>

        <p className="text-neutral-400 mt-2 mb-10">
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
              placeholder="ESCANOR Test"
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 outline-none"
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
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 outline-none"
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
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 outline-none"
            />

            <p className="text-xs text-neutral-600 mt-2">
              The token is encrypted before being stored.
            </p>
          </div>

          {error && (
            <div className="border border-red-900 bg-red-950/30 rounded-lg p-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-black rounded-lg py-3 font-medium disabled:opacity-50"
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
