/**
 * OpenAI cost estimation helpers.
 *
 * Kept framework-free and side-effect-free so they are trivially unit-testable
 * and can be reused anywhere usage is summarised. Prices are USD per 1,000,000
 * tokens, supplied as JSON in the OPENAI_PRICING env var, e.g.
 *
 *   OPENAI_PRICING={"gpt-5.6":{"in":1.25,"out":10},"gpt-5.6-mini":{"in":0.25,"out":2}}
 */

export type ModelPricing = {
  in: number;
  out: number;
};

export type ModelUsage = {
  model: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type CostEstimate = {
  estimatedCostUsd: number | null;
  costComplete: boolean;
};

/**
 * Parse the OPENAI_PRICING env value into a validated map. Anything malformed
 * (bad JSON, wrong shape, missing numeric fields) is ignored rather than
 * throwing, so a typo in the env never takes down the usage endpoint.
 */
export function parsePricing(
  raw: string | undefined
): Record<string, ModelPricing> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const pricing: Record<string, ModelPricing> = {};

    for (const [model, value] of Object.entries(parsed)) {
      if (
        value &&
        typeof value === "object" &&
        typeof (value as ModelPricing).in === "number" &&
        typeof (value as ModelPricing).out === "number"
      ) {
        pricing[model] = {
          in: (value as ModelPricing).in,
          out: (value as ModelPricing).out,
        };
      }
    }

    return pricing;
  } catch {
    return {};
  }
}

/**
 * Estimate total spend across per-model usage.
 *
 * Returns a null estimate when no pricing is configured, and flags the estimate
 * as incomplete when a model has real usage but no configured price — so the UI
 * can say "partial" instead of silently undercounting.
 */
/**
 * Built-in list prices, USD per 1M tokens (Anthropic list, Aug 2026 — Sonnet 5
 * uses the standard $3/$15 rate). OPENAI_PRICING env entries override these.
 * Lookup is prefix-aware, so a dated id like claude-haiku-4-5-20251001 matches
 * the claude-haiku-4-5 entry.
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": { in: 10, out: 50 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-3-opus": { in: 15, out: 75 },
};

function priceFor(
  model: string,
  pricing: Record<string, ModelPricing>
): ModelPricing | null {
  const merged = { ...DEFAULT_PRICING, ...pricing };
  if (merged[model]) {
    return merged[model];
  }
  let best: string | null = null;
  for (const key of Object.keys(merged)) {
    if (model.startsWith(key) && (!best || key.length > best.length)) {
      best = key;
    }
  }
  return best ? merged[best] : null;
}

export function estimateCost(
  models: ModelUsage[],
  pricing: Record<string, ModelPricing>
): CostEstimate {
  let cost = 0;
  let complete = true;

  for (const bucket of models) {
    const price = priceFor(bucket.model, pricing);

    if (!price) {
      complete = false;
      continue;
    }

    cost +=
      (bucket.inputTokens / 1_000_000) * price.in +
      (bucket.outputTokens / 1_000_000) * price.out;
  }

  return {
    estimatedCostUsd: Math.round(cost * 10000) / 10000,
    costComplete: complete,
  };
}
