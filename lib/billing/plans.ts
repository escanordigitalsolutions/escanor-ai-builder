/**
 * Plan definitions — the single place that knows what a plan costs, what it
 * includes, and which Stripe price it maps to.
 *
 * Price ids live in the environment rather than in code because they differ
 * between Stripe's test and live modes, and a deployment must be able to move
 * between them without a code change.
 */

export type PlanKey = "free" | "starter" | "pro" | "agency";

export type Plan = {
  key: PlanKey;
  name: string;
  /** Credits granted at the start of each billing period. */
  monthlyCredits: number;
  /** How many WordPress sites may be connected. null means no limit. */
  siteLimit: number | null;
  /** Environment variable holding the Stripe price id. Absent for free. */
  priceEnv?: string;
};

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    name: "Free",
    monthlyCredits: 0, // the 50-credit trial is a one-time grant, not a refill
    siteLimit: 1,
  },
  starter: {
    key: "starter",
    name: "Starter",
    monthlyCredits: 200,
    siteLimit: 1,
    priceEnv: "STRIPE_PRICE_STARTER",
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyCredits: 800,
    siteLimit: 5,
    priceEnv: "STRIPE_PRICE_PRO",
  },
  agency: {
    key: "agency",
    name: "Agency",
    monthlyCredits: 2500,
    siteLimit: null,
    priceEnv: "STRIPE_PRICE_AGENCY",
  },
};

/** Credits a single top-up purchase adds. */
export const TOPUP_CREDITS = 100;

/** Statuses where a subscription still entitles the customer to their plan. */
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && value in PLANS;
}

/**
 * A Stripe price id, or null if the variable holds something else.
 *
 * The mistake this catches is pasting the *amount* ("29") where the price id
 * belongs. Stripe rejects that with a message about price objects, three
 * layers away from the setting that caused it — checking the shape here names
 * the variable instead.
 */
function readPriceId(envName: string): string | null {
  const raw = (process.env[envName] ?? "").trim();
  return /^price_[A-Za-z0-9]+$/.test(raw) ? raw : null;
}

/** Why a price id is unusable, in words, or null when it is fine. */
export function priceProblem(envName: string): string | null {
  const raw = (process.env[envName] ?? "").trim();

  if (!raw) return `${envName} is not set.`;

  if (!/^price_[A-Za-z0-9]+$/.test(raw)) {
    return `${envName} is set to "${raw}", which is not a Stripe price id. Copy the id that starts with price_ from the price in Stripe → Products, not the amount.`;
  }

  return null;
}

export function priceEnvFor(key: PlanKey): string | null {
  return PLANS[key].priceEnv ?? null;
}

export function priceIdFor(key: PlanKey): string | null {
  const envName = PLANS[key].priceEnv;
  return envName ? readPriceId(envName) : null;
}

export function topupPriceId(): string | null {
  return readPriceId("STRIPE_PRICE_TOPUP");
}

/**
 * Resolve a Stripe price id back to a plan. Stripe tells us which price was
 * bought; this is how that becomes an entitlement.
 */
export function planForPriceId(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  for (const key of Object.keys(PLANS) as PlanKey[]) {
    if (priceIdFor(key) === priceId) return key;
  }
  return null;
}

/**
 * The plan a subscription row entitles its owner to right now.
 *
 * A canceled or unpaid subscription falls back to free rather than keeping the
 * paid plan — otherwise cancelling would leave the entitlement in place.
 */
export function activePlan(
  subscription: { plan_key?: string | null; status?: string | null } | null
): Plan {
  if (!subscription || !subscription.status || !LIVE_STATUSES.has(subscription.status)) {
    return PLANS.free;
  }
  return isPlanKey(subscription.plan_key) ? PLANS[subscription.plan_key] : PLANS.free;
}
