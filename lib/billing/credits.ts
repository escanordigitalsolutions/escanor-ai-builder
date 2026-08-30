import { createServiceClient } from "@/lib/supabase/service";

import { activePlan, type Plan } from "./plans";

/**
 * Credit accounting.
 *
 * Every function here goes through the service client. The browser can read
 * its own ledger rows (row-level security allows that) but can never write
 * one — a user able to insert into credit_ledger could grant themselves
 * credits, so writes exist only on the server.
 */

export type GrantReason = "signup_grant" | "plan_grant" | "topup" | "refund" | "admin";

export class InsufficientCredits extends Error {
  constructor(readonly needed: number) {
    super("insufficient_credits");
    this.name = "InsufficientCredits";
  }
}

export async function creditBalance(userId: string): Promise<number> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("credit_balance", { p_user_id: userId });

  if (error) {
    console.error("credit_balance error:", error);
    return 0;
  }

  return typeof data === "number" ? data : 0;
}

/**
 * Add credits.
 *
 * `ref` is what makes this safe to call twice: the unique index on
 * (reason, ref) turns a redelivered Stripe webhook into a no-op instead of a
 * second helping of credits. Always pass the id of the Stripe object that
 * justified the grant.
 *
 * Returns true when a row was actually written, false when this grant had
 * already been recorded.
 */
export async function grantCredits(
  userId: string,
  amount: number,
  reason: GrantReason,
  ref: string,
  note?: string
): Promise<boolean> {
  if (amount <= 0) return false;

  const db = createServiceClient();

  const { error } = await db
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, reason, ref, note: note ?? null });

  if (error) {
    // 23505 is a unique violation: this exact grant is already on the ledger.
    if (error.code === "23505") return false;
    console.error("grantCredits error:", error);
    throw new Error("Could not grant credits.");
  }

  return true;
}

/**
 * Spend credits atomically, refusing if the balance will not cover it.
 *
 * The check and the debit happen inside one Postgres function holding a
 * per-user advisory lock, so two callers cannot both pass a balance check that
 * only one of them could afford.
 *
 * Metered AI usage does NOT go through here — see recordUsageDebit for why.
 * This is for charging a known price up front, which is what reserving credits
 * before an expensive build would need.
 *
 * Throws InsufficientCredits when the balance will not cover the amount.
 */
export async function spendCredits(
  userId: string,
  amount: number,
  ref?: string,
  note?: string
): Promise<number> {
  if (amount <= 0) return creditBalance(userId);

  const db = createServiceClient();

  const { data, error } = await db.rpc("spend_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: "usage",
    p_ref: ref ?? null,
    p_note: note ?? null,
  });

  if (error) {
    if ((error.message ?? "").includes("insufficient_credits")) {
      throw new InsufficientCredits(amount);
    }
    console.error("spendCredits error:", error);
    throw new Error("Could not record credit usage.");
  }

  return typeof data === "number" ? data : 0;
}

/**
 * Record what a model call actually cost, unconditionally.
 *
 * This is NOT spendCredits. Usage is billed after the work is done, so there
 * is nothing left to authorise — refusing the debit here would not un-run the
 * model, it would only lose the money. The account is allowed to go negative
 * by at most one operation; the gate in authenticateSiteRequest refuses the
 * next request.
 *
 * There is no race to guard against either: the ledger is append-only and the
 * balance is a sum, so concurrent debits simply both land.
 */
export async function recordUsageDebit(
  userId: string,
  credits: number,
  ref?: string,
  note?: string
): Promise<void> {
  // Below this a charge is rounding noise, and the row costs more to store
  // than the credit it records.
  if (!Number.isFinite(credits) || credits < 0.0001) return;

  const db = createServiceClient();

  const { error } = await db.from("credit_ledger").insert({
    user_id: userId,
    delta: -Number(credits.toFixed(4)),
    reason: "usage",
    ref: ref ?? null,
    note: note ?? null,
  });

  if (error) {
    console.error("recordUsageDebit error:", error);
  }
}

/**
 * Give back everything one job charged, when that job delivered nothing.
 *
 * A generation that times out has already been billed: usage is debited stage
 * by stage, as each model call returns, because that is when the money was
 * really spent. If the run then dies before producing anything the person can
 * use, keeping those credits is charging for nothing.
 *
 * Idempotent by construction. The ledger's unique index on (reason, ref) for
 * positive deltas means a second refund for the same job silently does
 * nothing — which matters here, because both the job itself and the stalled-job
 * sweep in job-status can reach this for the same failure.
 */
export async function refundJobUsage(
  jobId: string,
  note = "Refund: generation failed"
): Promise<number> {
  if (!jobId) return 0;

  const db = createServiceClient();
  const ref = usageRef(jobId);

  const { data: rows, error } = await db
    .from("credit_ledger")
    .select("user_id, delta")
    .eq("ref", ref)
    .eq("reason", "usage");

  if (error) {
    console.error("refundJobUsage read error:", error);
    return 0;
  }

  if (!rows || !rows.length) return 0;

  // Every row for one job belongs to one owner; taking it from the data keeps
  // this callable from places that never looked the user up.
  const userId = String(rows[0].user_id);
  const spent = rows.reduce((sum, row) => sum + Number(row.delta ?? 0), 0);
  const refund = Math.abs(Number(spent.toFixed(4)));

  if (refund < 0.0001) return 0;

  const { error: insertError } = await db.from("credit_ledger").insert({
    user_id: userId,
    delta: refund,
    reason: "refund",
    ref,
    note: note.slice(0, 300),
  });

  if (insertError) {
    // 23505 is the unique index doing its job: this refund already happened.
    if (insertError.code === "23505") return 0;
    console.error("refundJobUsage insert error:", insertError);
    return 0;
  }

  console.log(`refunded ${refund} credits for ${ref}`);
  return refund;
}

/** How a usage row names the job that caused it. */
export function usageRef(jobId: string): string {
  return `job:${jobId}`;
}

export type Entitlement = {
  plan: Plan;
  balance: number;
  subscription: {
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
};

/** Everything the app needs to decide what a user may do right now. */
export async function entitlementFor(userId: string): Promise<Entitlement> {
  const db = createServiceClient();

  const [{ data: sub }, balance] = await Promise.all([
    db
      .from("subscriptions")
      .select("plan_key, status, current_period_end, cancel_at_period_end")
      .eq("user_id", userId)
      .maybeSingle(),
    creditBalance(userId),
  ]);

  return {
    plan: activePlan(sub ?? null),
    balance,
    subscription: sub
      ? {
          status: String(sub.status),
          current_period_end: sub.current_period_end
            ? String(sub.current_period_end)
            : null,
          cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        }
      : null,
  };
}
