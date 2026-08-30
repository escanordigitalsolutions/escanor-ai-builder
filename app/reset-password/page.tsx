"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  AuthError,
  AuthField,
  AuthShell,
  AuthSubmit,
} from "@/components/auth-shell";

const MIN_PASSWORD = 8;

/**
 * Set a new password.
 *
 * Reaching this screen means /auth/callback already turned the emailed
 * recovery code into a real session — so the update below is an ordinary
 * authenticated call, not a token exchange. Without that session there is
 * nothing to update, which is what the `ready === false` state covers.
 */
export default function ResetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setReady(Boolean(data.user));
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (ready === null) {
    return (
      <AuthShell title="Set a new password" subtitle="Checking your reset link…">
        <div className="h-24" />
      </AuthShell>
    );
  }

  if (!ready) {
    return (
      <AuthShell
        title="That link has expired"
        subtitle="Reset links can be used once and are valid for one hour."
        footer={
          <Link href="/login" className="font-medium text-neutral-900 underline underline-offset-2">
            Back to sign in
          </Link>
        }
      >
        <Link href="/forgot-password" className="btn-accent block py-3 text-center font-medium">
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a password you have not used here before."
    >
      <form onSubmit={handleUpdate} className="flex flex-col gap-5">
        <AuthField
          id="password"
          label="New password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <AuthField
          id="confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />

        <AuthError>{error}</AuthError>

        <AuthSubmit loading={loading} idle="Save password" busy="Saving…" />
      </form>
    </AuthShell>
  );
}
