"use client";

import { FormEvent, useState } from "react";
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

export default function SignupPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      return;
    }

    setLoading(true);
    setError("");

    const supabase = createClient();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Lands on the callback route, which exchanges the code for a session.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Read by the handle_new_user() trigger to fill the profile row.
        data: { full_name: fullName.trim(), company: company.trim() },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // With email confirmation off, Supabase signs the user straight in.
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a confirmation link to ${email}. Open it to activate your account.`}
        footer={
          <>
            Wrong address?{" "}
            <button
              type="button"
              onClick={() => setSent(false)}
              className="font-medium text-neutral-900 underline underline-offset-2"
            >
              Start over
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-neutral-600">
          The link is valid for one hour. If it does not arrive within a few
          minutes, check your spam folder.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Build WordPress sites with AI, on your own hosting."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-neutral-900 underline underline-offset-2">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSignup} className="flex flex-col gap-5">
        <AuthField
          id="full-name"
          label="Your name"
          type="text"
          autoComplete="name"
          required
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />

        <AuthField
          id="company"
          label="Company"
          hint="Optional — appears on your invoices."
          type="text"
          autoComplete="organization"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
        />

        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <AuthField
          id="password"
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <AuthError>{error}</AuthError>

        <AuthSubmit loading={loading} idle="Create account" busy="Creating account…" />

        <p className="text-xs leading-relaxed text-neutral-500">
          By creating an account you agree to our{" "}
          <Link href="/legal/terms" className="underline underline-offset-2">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthShell>
  );
}
