"use client";

import { useState } from "react";

/**
 * Credits, plan and the buttons that change them.
 *
 * Prices are written here rather than imported from lib/billing/plans, which
 * reads STRIPE_PRICE_* from the environment — server-only values that would
 * arrive as undefined in a client bundle. The server decides what a price id
 * is; this component only names the plan it wants.
 */

type PurchasablePlan = {
  key: "starter" | "pro" | "agency";
  name: string;
  price: string;
  credits: string;
};

const PURCHASABLE: PurchasablePlan[] = [
  { key: "starter", name: "Starter", price: "€29/mo", credits: "200 credits" },
  { key: "pro", name: "Pro", price: "€79/mo", credits: "800 credits" },
  { key: "agency", name: "Agency", price: "€199/mo", credits: "2,500 credits" },
];

export default function BillingPanel({
  balance,
  planKey,
  planName,
  siteLimit,
  siteCount,
  status,
  renewsAt,
  cancelAtPeriodEnd,
  canManage,
}: {
  balance: number;
  planKey: string;
  planName: string;
  siteLimit: number | null;
  siteCount: number;
  status: string | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canManage: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Shown verbatim while DEBUG_ERRORS is on, so a misconfiguration names
  // itself instead of hiding behind "something went wrong".
  const [detail, setDetail] = useState("");

  async function go(endpoint: string, body?: Record<string, unknown>) {
    setBusy(endpoint + (body?.plan ?? body?.mode ?? ""));
    setError("");
    setDetail("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });

      const data = (await response.json()) as {
        url?: string;
        error?: string;
        code?: string;
        detail?: string;
        missing?: string[];
      };

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      setError(data.error ?? "Something went wrong. Try again.");
      setDetail(
        [
          `HTTP ${response.status}${data.code ? ` · ${data.code}` : ""}`,
          data.missing?.length ? `missing: ${data.missing.join(", ")}` : "",
          data.detail ?? "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (e) {
      setError("Could not reach the billing service.");
      setDetail(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }

    setBusy(null);
  }

  const low = balance <= 0;
  const paid = planKey !== "free";

  return (
    <section id="billing" className="glass-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
            Credits
          </p>
          <p
            className={
              "mt-1.5 font-mono text-[2.4rem] font-medium leading-none tabular-nums " +
              (low ? "text-red-600" : "text-neutral-900")
            }
          >
            {balance.toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-neutral-500">
            {low
              ? "You are out of credits — AI features are paused until you top up."
              : "Spent as the AI works. Your dashboard records every charge."}
          </p>
        </div>

        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
            Plan
          </p>
          <p className="mt-1.5 text-[1.1rem] font-semibold tracking-tight text-neutral-900">
            {planName}
          </p>
          <p
            className={
              "mt-1 text-sm " +
              (siteLimit !== null && siteCount > siteLimit
                ? "text-amber-700"
                : "text-neutral-500")
            }
          >
            {siteLimit === null
              ? `${siteCount} ${siteCount === 1 ? "site" : "sites"}`
              : siteCount > siteLimit
                ? `${siteCount} sites · plan covers ${siteLimit}`
                : `${siteCount} of ${siteLimit} ${siteLimit === 1 ? "site" : "sites"} used`}
          </p>
          {paid && renewsAt ? (
            <p className="mt-1 text-xs text-neutral-500">
              {cancelAtPeriodEnd ? "Ends" : "Renews"}{" "}
              {new Date(renewsAt).toLocaleDateString()}
              {status && status !== "active" ? ` · ${status}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-lg bg-red-50 px-3.5 py-2.5">
          <p className="text-sm text-red-700">{error}</p>
          {detail ? (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-red-900/70">
              {detail}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 border-t border-neutral-900/[0.08] pt-5">
        {paid ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => go("/api/billing/checkout", { mode: "topup" })}
              disabled={busy !== null}
              className="btn-accent px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {busy === "/api/billing/checkouttopup"
                ? "Opening…"
                : "Buy 100 credits — €15"}
            </button>
            <button
              type="button"
              onClick={() => go("/api/billing/portal")}
              disabled={busy !== null}
              className="btn-ghost px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {busy === "/api/billing/portal" ? "Opening…" : "Manage billing"}
            </button>
            <p className="text-xs text-neutral-500">
              Change plan, update your card or cancel in Stripe.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-neutral-600">
              Choose a plan to get monthly credits. Prices exclude VAT, added at
              checkout.
            </p>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {PURCHASABLE.map((plan) => (
                <button
                  key={plan.key}
                  type="button"
                  onClick={() => go("/api/billing/checkout", { plan: plan.key })}
                  disabled={busy !== null}
                  className="glass-soft flex flex-col items-start px-4 py-3 text-left transition-colors hover:bg-white disabled:opacity-50"
                >
                  <span className="text-sm font-semibold text-neutral-900">
                    {plan.name}
                  </span>
                  <span className="mt-0.5 font-mono text-[0.82rem] tabular-nums text-neutral-700">
                    {busy === "/api/billing/checkout" + plan.key
                      ? "Opening…"
                      : plan.price}
                  </span>
                  <span className="mt-0.5 text-xs text-neutral-500">
                    {plan.credits}
                  </span>
                </button>
              ))}
            </div>
            {canManage ? (
              <button
                type="button"
                onClick={() => go("/api/billing/portal")}
                disabled={busy !== null}
                className="mt-3 text-sm text-neutral-500 underline underline-offset-4 hover:text-neutral-800 disabled:opacity-50"
              >
                View past invoices
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
