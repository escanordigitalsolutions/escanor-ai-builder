"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Deleting an account.
 *
 * Folded away behind a plain link, because a red button sitting permanently
 * under the password form is a hazard, not a feature. Opening it says plainly
 * what goes and what stays — a person who is about to lose their themes
 * deserves to read that before they type anything, not after.
 */
export default function AccountDanger({
  email,
  projects,
  hasSubscription,
}: {
  email: string;
  projects: number;
  hasSubscription: boolean;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.detail ? `${data.error} — ${data.detail}` : (data.error ?? "Could not delete the account."));
        setBusy(false);
        return;
      }

      // The login page renders ?message= as a notice, so the person lands on
      // a page that confirms what happened rather than a silent home page.
      router.push(
        "/login?message=" +
          encodeURIComponent("Your account and all its data have been deleted.")
      );
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-neutral-400 underline-offset-2 transition hover:text-red-600 hover:underline"
        >
          Delete my account
        </button>
      </div>
    );
  }

  return (
    <section className="glass-card border-red-200 p-6">
      <h2 className="text-[1.02rem] font-semibold tracking-tight text-neutral-900">
        Delete your account
      </h2>

      <p className="mt-3 text-sm text-neutral-600">
        This removes your profile, your credits and{" "}
        <strong className="font-medium text-neutral-900">
          {projects === 1 ? "1 site" : `${projects} sites`}
        </strong>{" "}
        with every design, chat and usage record attached. It cannot be undone.
      </p>

      <ul className="mt-4 flex flex-col gap-1.5 text-xs text-neutral-500">
        <li>
          Themes already written to your own WordPress stay where they are — deleting
          your account does not touch your server.
        </li>
        {hasSubscription ? (
          <li className="text-neutral-700">
            Your subscription is cancelled at the same time. No further charges.
          </li>
        ) : null}
        <li>
          Invoices stay at Stripe for ten years, as accounting law requires.
        </li>
      </ul>

      <form onSubmit={remove} className="mt-6 flex flex-col gap-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-neutral-700" htmlFor="confirm-email">
            Type <span className="font-mono text-[0.85em] text-neutral-900">{email}</span> to confirm
          </label>
          <input
            id="confirm-email"
            autoComplete="off"
            value={confirmEmail}
            onChange={(event) => setConfirmEmail(event.target.value)}
            className="field px-4 py-2.5 text-[0.92rem]"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-neutral-700" htmlFor="delete-password">
            Your password
          </label>
          <input
            id="delete-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="field px-4 py-2.5 text-[0.92rem]"
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || confirmEmail.trim().toLowerCase() !== email.toLowerCase() || !password}
            className="rounded-[10px] bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
          >
            {busy ? "Deleting…" : "Delete my account permanently"}
          </button>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirmEmail("");
              setPassword("");
              setError("");
            }}
            disabled={busy}
            className="btn-ghost px-4 py-2.5 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
