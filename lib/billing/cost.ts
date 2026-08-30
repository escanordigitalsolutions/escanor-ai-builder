import { parsePricing, priceFor } from "@/lib/ai/pricing";

/**
 * Turning model tokens into credits.
 *
 * The chain is: tokens → USD (using the same OPENAI_PRICING table the usage
 * dashboard already audits against) → credits. Keeping one price table for
 * both means the number a customer is charged and the number shown in the
 * operations report can never drift apart.
 */

/** What one credit is worth in model spend, before margin. */
const CREDIT_USD = positiveEnv("CREDIT_USD_VALUE", 0.02);

/**
 * Multiplier applied on top of raw model cost. This is the margin that pays
 * for hosting, support and the free trial — without it every plan sells AI at
 * exactly what it costs.
 */
const MARGIN = positiveEnv("CREDIT_MARGIN", 4);

/**
 * Rate assumed when a model is missing from the price table. Deliberately not
 * zero: an unpriced model must never mean unlimited free work.
 */
const FALLBACK_USD_PER_MTOK = positiveEnv("CREDIT_FALLBACK_USD_PER_MTOK", 6);

function positiveEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Raw model spend in USD, before any margin. */
export function usdFor(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const price = priceFor(model, parsePricing(process.env.OPENAI_PRICING));

  if (price) {
    return (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out;
  }

  return ((inputTokens + outputTokens) / 1_000_000) * FALLBACK_USD_PER_MTOK;
}

/**
 * Credits to charge for one model call.
 *
 * Rounded to the nearest whole credit rather than always up: a single cheap
 * chat message genuinely costs a fraction of a credit, and charging a full one
 * for it would contradict what the pricing page promises. Rounding is fair in
 * both directions and averages out across a session.
 */
export function creditsFor(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const tokens = Math.max(0, inputTokens) + Math.max(0, outputTokens);
  if (tokens === 0) return 0;

  const billable = usdFor(model, inputTokens, outputTokens) * MARGIN;

  return Math.max(0, Math.round(billable / CREDIT_USD));
}
