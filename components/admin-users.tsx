"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AdminUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  company: string | null;
  is_admin: boolean;
  created_at: string;
  stripe_customer_id: string | null;
  credits: number;
  plan_key: string | null;
  status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  manual_subscription: boolean;
  projects: number;
  last_activity: string | null;
};

const PLANS = ["free", "starter", "pro", "agency"] as const;
const STATUSES = ["active", "trialing", "past_due", "canceled"] as const;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "2-digit",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

export default function AdminUsers({ users }: { users: AdminUserRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? users.filter((u) =>
        [u.email, u.full_name, u.company]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))
      )
    : users;

  return (
    <>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by email, name or company"
        className="field mb-4 max-w-sm px-4 py-2.5 text-[0.92rem]"
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr>
              {["Account", "Credits", "Plan", "Sites", "Last AI use", "Joined", ""].map(
                (h) => (
                  <th
                    key={h}
                    className="border-b border-neutral-900/15 py-2 pr-5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-neutral-500"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((user) => (
              <Row
                key={user.id}
                user={user}
                open={open === user.id}
                onToggle={() => setOpen(open === user.id ? null : user.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {shown.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">Nothing matches that.</p>
      ) : null}
    </>
  );
}

function Row({
  user,
  open,
  onToggle,
}: {
  user: AdminUserRow;
  open: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState(user.plan_key ?? "free");
  const [status, setStatus] = useState(user.status ?? "active");

  async function call(path: string, body: unknown, tag: string) {
    setBusy(tag);
    setError("");

    try {
      const response = await fetch(`/api/admin/users/${user.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as { error?: string; detail?: string };

      if (!response.ok) {
        setError(
          `${data.error ?? "Failed."}${data.detail ? `\n${data.detail}` : ""}`
        );
      } else {
        setAmount("");
        setNote("");
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }

    setBusy("");
  }

  const paidLive = Boolean(user.plan_key) && !user.manual_subscription;

  return (
    <>
      <tr className={open ? "bg-neutral-900/[0.02]" : undefined}>
        <td className="border-b border-neutral-900/[0.07] py-2.5 pr-5">
          <span className="flex items-center gap-2">
            <span className="font-medium text-neutral-900">
              {user.email ?? "—"}
            </span>
            {user.is_admin ? (
              <span className="rounded-full bg-brand/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand">
                Admin
              </span>
            ) : null}
          </span>
          {user.full_name || user.company ? (
            <span className="mt-0.5 block text-[12px] text-neutral-500">
              {[user.full_name, user.company].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </td>

        <td
          className={
            "border-b border-neutral-900/[0.07] py-2.5 pr-5 font-mono tabular-nums " +
            (user.credits <= 0 ? "text-red-600" : "text-neutral-700")
          }
        >
          {Math.round(user.credits).toLocaleString()}
        </td>

        <td className="border-b border-neutral-900/[0.07] py-2.5 pr-5 text-neutral-700">
          {user.plan_key ? (
            <>
              <span className="capitalize">{user.plan_key}</span>
              {user.manual_subscription ? (
                <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                  comped
                </span>
              ) : null}
              {user.status && user.status !== "active" ? (
                <span className="ml-1.5 text-[11px] text-amber-700">
                  {user.status}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-neutral-400">free</span>
          )}
        </td>

        <td className="border-b border-neutral-900/[0.07] py-2.5 pr-5 tabular-nums text-neutral-700">
          {user.projects}
        </td>

        <td className="border-b border-neutral-900/[0.07] py-2.5 pr-5 tabular-nums text-neutral-600">
          {fmt(user.last_activity)}
        </td>

        <td className="border-b border-neutral-900/[0.07] py-2.5 pr-5 tabular-nums text-neutral-600">
          {fmt(user.created_at)}
        </td>

        <td className="border-b border-neutral-900/[0.07] py-2.5 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="text-[13px] font-medium text-brand hover:underline"
          >
            {open ? "Close" : "Manage"}
          </button>
        </td>
      </tr>

      {open ? (
        <tr>
          <td colSpan={7} className="border-b border-neutral-900/[0.07] bg-neutral-900/[0.02] px-0 pb-6 pt-1">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Credits */}
              <div>
                <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-neutral-500">
                  Adjust credits
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="e.g. 500 or -100"
                    inputMode="numeric"
                    className="field w-36 px-3 py-2 text-[0.9rem]"
                  />
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Reason (optional)"
                    className="field w-52 px-3 py-2 text-[0.9rem]"
                  />
                  <button
                    type="button"
                    disabled={busy !== "" || !amount.trim()}
                    onClick={() =>
                      call("credits", { delta: Number(amount), note }, "credits")
                    }
                    className="btn-accent px-3.5 py-2 text-[13px] font-medium disabled:opacity-50"
                  >
                    {busy === "credits" ? "Applying…" : "Apply"}
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-neutral-500">
                  Balance is now {Math.round(user.credits).toLocaleString()}. Negative
                  numbers take credits away; both land in the account&rsquo;s
                  ledger.
                </p>
              </div>

              {/* Plan */}
              <div>
                <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-neutral-500">
                  Plan
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={plan}
                    onChange={(event) => setPlan(event.target.value)}
                    disabled={paidLive}
                    className="field w-32 px-3 py-2 text-[0.9rem] disabled:opacity-50"
                  >
                    {PLANS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    disabled={paidLive || plan === "free"}
                    className="field w-32 px-3 py-2 text-[0.9rem] disabled:opacity-50"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy !== "" || paidLive}
                    onClick={() => call("subscription", { plan, status }, "plan")}
                    className="btn-accent px-3.5 py-2 text-[13px] font-medium disabled:opacity-50"
                  >
                    {busy === "plan" ? "Saving…" : "Save plan"}
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-neutral-500">
                  {paidLive
                    ? "This account pays through Stripe. Change the plan there so billing follows it — editing here would be undone by the next webhook."
                    : "Comped plans are set here and grant credits only when you add them above. Stripe overrides this if the account ever subscribes for real."}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-neutral-900/[0.07] pt-4">
              <button
                type="button"
                disabled={busy !== ""}
                onClick={() =>
                  call("admin-flag", { isAdmin: !user.is_admin }, "flag")
                }
                className="btn-ghost px-3.5 py-2 text-[13px] font-medium disabled:opacity-50"
              >
                {busy === "flag"
                  ? "Saving…"
                  : user.is_admin
                    ? "Remove admin rights"
                    : "Make admin"}
              </button>

              <span className="font-mono text-[11px] text-neutral-400">
                {user.id}
              </span>

              {user.stripe_customer_id &&
              !user.stripe_customer_id.startsWith("manual:") ? (
                <a
                  href={`https://dashboard.stripe.com/customers/${user.stripe_customer_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] font-medium text-brand hover:underline"
                >
                  Open in Stripe →
                </a>
              ) : null}
            </div>

            {error ? (
              <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg bg-red-50 px-3.5 py-2.5 font-mono text-[11px] text-red-800">
                {error}
              </pre>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
