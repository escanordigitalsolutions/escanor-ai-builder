import { describe, it, expect } from "vitest";

import {
  estimateCost,
  parsePricing,
  type ModelUsage,
} from "@/lib/ai/pricing";

function usage(
  model: string,
  inputTokens: number,
  outputTokens: number
): ModelUsage {
  return {
    model,
    runs: 1,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

describe("parsePricing", () => {
  it("returns an empty map for missing or malformed input", () => {
    expect(parsePricing(undefined)).toEqual({});
    expect(parsePricing("")).toEqual({});
    expect(parsePricing("not json")).toEqual({});
    expect(parsePricing("123")).toEqual({});
    expect(parsePricing("[1,2,3]")).toEqual({});
  });

  it("keeps only well-formed model entries", () => {
    const pricing = parsePricing(
      JSON.stringify({
        good: { in: 1.25, out: 10 },
        missingOut: { in: 1 },
        wrongType: { in: "x", out: 2 },
      })
    );

    expect(pricing).toEqual({ good: { in: 1.25, out: 10 } });
  });
});

describe("estimateCost", () => {
  it("returns a null estimate when no pricing is configured", () => {
    const result = estimateCost([usage("m", 1000, 500)], {});
    expect(result.estimatedCostUsd).toBeNull();
    expect(result.costComplete).toBe(true);
  });

  it("computes cost per million tokens", () => {
    const result = estimateCost(
      [usage("m", 1_000_000, 500_000)],
      { m: { in: 2, out: 10 } }
    );

    // 1M in * $2/M + 0.5M out * $10/M = 2 + 5 = 7
    expect(result.estimatedCostUsd).toBe(7);
    expect(result.costComplete).toBe(true);
  });

  it("sums across models", () => {
    const result = estimateCost(
      [usage("a", 1_000_000, 0), usage("b", 0, 1_000_000)],
      { a: { in: 1, out: 1 }, b: { in: 3, out: 4 } }
    );

    // a: 1*1 = 1 ; b: 1*4 = 4 ; total = 5
    expect(result.estimatedCostUsd).toBe(5);
  });

  it("flags the estimate as incomplete for an unpriced model", () => {
    const result = estimateCost(
      [usage("priced", 1_000_000, 0), usage("unpriced", 1_000_000, 0)],
      { priced: { in: 1, out: 1 } }
    );

    expect(result.estimatedCostUsd).toBe(1);
    expect(result.costComplete).toBe(false);
  });
});
