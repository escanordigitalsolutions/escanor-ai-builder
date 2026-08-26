"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f5f6f7] text-neutral-900">
      <div className="w-full max-w-md border border-neutral-200 bg-white rounded-2xl p-8">
        <div className="mb-8">
          <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-2">
            ESCANOR
          </p>

          <h1 className="text-2xl font-semibold tracking-tight">
            AI Builder
          </h1>

          <p className="text-neutral-500 mt-2">
            Sign in to your development workspace.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm mb-2">
              Email
            </label>

            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-neutral-200 bg-white px-4 py-3 text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400"
            />
          </div>

          <div>
            <label className="block text-sm mb-2">
              Password
            </label>

            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-neutral-200 bg-white px-4 py-3 text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
