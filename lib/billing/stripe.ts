import Stripe from "stripe";

/**
 * Server-side Stripe client.
 *
 * Created lazily so that importing this module — which route files do at build
 * time — never throws when the key is absent. A missing key should fail the
 * one request that needs Stripe, not the whole deployment.
 */

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (client) return client;

  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  // No apiVersion override: the SDK pins its own, which is deterministic for
  // a given package version. Naming one here would have to match the SDK's
  // literal type exactly and would break the build on every SDK upgrade.
  client = new Stripe(key, {
    appInfo: { name: "Meikero", url: "https://meikero.com" },
  });

  return client;
}

export function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }

  return secret;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Which billing environment variables are absent.
 *
 * "Billing is not configured" is a useless thing to read when four different
 * variables could be the one missing — this names them so the fix is obvious
 * without opening the Vercel dashboard to guess.
 */
export function missingStripeConfig(): string[] {
  return [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_STARTER",
    "STRIPE_PRICE_PRO",
    "STRIPE_PRICE_AGENCY",
    "STRIPE_PRICE_TOPUP",
  ].filter((name) => !process.env[name]);
}
