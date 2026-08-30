"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import {
  AuthError,
  AuthField,
  AuthShell,
  AuthSubmit,
} from "@/components/auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");

    const supabase = createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // The callback exchanges the recovery code for a session, then hands the
      // user to the screen where they actually pick a new password.
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    // Anything other than a transport failure is reported as success on
    // purpose: telling the visitor whether an address exists would turn this
    // form into an account-enumeration oracle.
    if (error && error.status && error.status >= 500) {
      setError("We could not send the email just now. Try again in a moment.");
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`If an account exists for ${email}, a reset link is on its way.`}
        footer={
          <Link href="/login" className="font-medium text-neutral-900 underline underline-offset-2">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm leading-relaxed text-neutral-600">
          The link is valid for one hour and can be used once. If it does not
          arrive within a few minutes, check your spam folder.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we will send you a link to set a new one."
      footer={
        <Link href="/login" className="font-medium text-neutral-900 underline underline-offset-2">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleReset} className="flex flex-col gap-5">
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <AuthError>{error}</AuthError>

        <AuthSubmit loading={loading} idle="Send reset link" busy="Sending…" />
      </form>
    </AuthShell>
  );
}
