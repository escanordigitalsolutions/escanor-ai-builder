"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  AuthError,
  AuthField,
  AuthNotice,
  AuthShell,
  AuthSubmit,
} from "@/components/auth-shell";

/** Only ever follow an in-app path — an absolute `next` would be an open redirect. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // /auth/callback reports expired or already-used links back here.
  const linkError = params.get("error") ?? "";
  const notice = params.get("message") ?? "";

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back to your Meikero workspace."
      footer={
        <>
          No account yet?{" "}
          <Link href="/signup" className="font-medium text-neutral-900 underline underline-offset-2">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleLogin} className="flex flex-col gap-5">
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <div>
          <AuthField
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="mt-2 text-right">
            <Link
              href="/forgot-password"
              className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
            >
              Forgot your password?
            </Link>
          </div>
        </div>

        <AuthNotice>{notice}</AuthNotice>
        <AuthError>{error || linkError}</AuthError>

        <AuthSubmit loading={loading} idle="Sign in" busy="Signing in…" />
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary or the production build fails.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
