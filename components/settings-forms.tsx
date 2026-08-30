"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const MIN_PASSWORD = 8;

/**
 * Profile and password.
 *
 * Both write straight from the browser: row-level security lets a user update
 * their own profile row, and the column grant covers only full_name and
 * company — is_admin and stripe_customer_id are not writable here even if the
 * request asked for them.
 */
export default function SettingsForms({
  email,
  fullName: initialName,
  company: initialCompany,
}: {
  email: string;
  fullName: string;
  company: string;
}) {
  const router = useRouter();

  const [fullName, setFullName] = useState(initialName);
  const [company, setCompany] = useState(initialCompany);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNote, setProfileNote] = useState("");
  const [profileError, setProfileError] = useState("");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordNote, setPasswordNote] = useState("");
  const [passwordError, setPasswordError] = useState("");

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileNote("");
    setProfileError("");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setProfileError("Your session expired. Sign in again.");
      setSavingProfile(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim(), company: company.trim() })
      .eq("id", user.id);

    if (error) {
      setProfileError(error.message);
    } else {
      setProfileNote("Saved.");
      router.refresh();
    }

    setSavingProfile(false);
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordNote("");
    setPasswordError("");

    if (password.length < MIN_PASSWORD) {
      setPasswordError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }

    if (password !== confirm) {
      setPasswordError("The two passwords do not match.");
      return;
    }

    setSavingPassword(true);

    const { error } = await createClient().auth.updateUser({ password });

    if (error) {
      setPasswordError(error.message);
    } else {
      setPasswordNote("Password updated.");
      setPassword("");
      setConfirm("");
    }

    setSavingPassword(false);
  }

  return (
    <div className="mt-8 flex flex-col gap-4">
      <section className="glass-card p-6">
        <h2 className="text-[1.02rem] font-semibold tracking-tight text-neutral-900">
          Your details
        </h2>

        <form onSubmit={saveProfile} className="mt-5 flex flex-col gap-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700">
              Email
            </label>
            <input
              value={email}
              disabled
              className="field px-4 py-2.5 text-[0.92rem] opacity-60"
            />
            <p className="mt-1.5 text-xs text-neutral-500">
              Contact support to change the address you sign in with.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700" htmlFor="full-name">
              Name
            </label>
            <input
              id="full-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="field px-4 py-2.5 text-[0.92rem]"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700" htmlFor="company">
              Company
            </label>
            <input
              id="company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              className="field px-4 py-2.5 text-[0.92rem]"
            />
            <p className="mt-1.5 text-xs text-neutral-500">
              Appears on your invoices.
            </p>
          </div>

          {profileError ? (
            <p className="text-sm text-red-600">{profileError}</p>
          ) : null}
          {profileNote ? (
            <p className="text-sm text-emerald-700">{profileNote}</p>
          ) : null}

          <div>
            <button
              type="submit"
              disabled={savingProfile}
              className="btn-accent px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {savingProfile ? "Saving…" : "Save details"}
            </button>
          </div>
        </form>
      </section>

      <section className="glass-card p-6">
        <h2 className="text-[1.02rem] font-semibold tracking-tight text-neutral-900">
          Password
        </h2>

        <form onSubmit={savePassword} className="mt-5 flex flex-col gap-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700" htmlFor="new-password">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="field px-4 py-2.5 text-[0.92rem]"
            />
            <p className="mt-1.5 text-xs text-neutral-500">
              At least {MIN_PASSWORD} characters.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700" htmlFor="confirm-password">
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="field px-4 py-2.5 text-[0.92rem]"
            />
          </div>

          {passwordError ? (
            <p className="text-sm text-red-600">{passwordError}</p>
          ) : null}
          {passwordNote ? (
            <p className="text-sm text-emerald-700">{passwordNote}</p>
          ) : null}

          <div>
            <button
              type="submit"
              disabled={savingPassword}
              className="btn-accent px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {savingPassword ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
