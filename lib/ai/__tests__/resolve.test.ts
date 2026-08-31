import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Model tier routing.
 *
 * The bug these tests exist for: file generation was running on Sonnet. Nobody
 * asked for that — MODEL_BUILD was set to a Claude id, the build tier read it,
 * and the plan tier merely inherited it. The strong model landed on the
 * highest-volume mechanical tier and only accidentally on the creative one.
 *
 * The rule now: the creative tiers (plan, design) take the strong model, every
 * other tier is cheap, and no tier inherits from another.
 */

const MODEL_ENV = [
  "MODEL_DESIGN",
  "MODEL_PLAN",
  "MODEL_BUILD",
  "MODEL_EDIT",
  "MODEL_CHAT",
  "MODEL_CHEAP",
  "OPENAI_MODEL",
  "OPENAI_MODEL_GEN",
  "OPENAI_MODEL_SMART",
  "OPENAI_MODEL_FAST",
] as const;

const CHEAP = "gpt-5.6-luna";
const STRONG = "claude-sonnet-5";

/** Import resolve.ts fresh with only the given model env set. */
async function loadTiers(env: Partial<Record<(typeof MODEL_ENV)[number], string>>) {
  vi.resetModules();
  for (const key of MODEL_ENV) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("../resolve");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("TIER_DEFAULTS", () => {
  it("puts MODEL_DESIGN on the creative tiers only", async () => {
    const { TIER_DEFAULTS } = await loadTiers({ MODEL_DESIGN: STRONG });

    expect(TIER_DEFAULTS.design).toBe(STRONG);
    expect(TIER_DEFAULTS.plan).toBe(STRONG);

    // Everything mechanical stays cheap. This is the regression: before the
    // fix, `build` was the tier the strong model actually reached.
    expect(TIER_DEFAULTS.build).toBe(CHEAP);
    expect(TIER_DEFAULTS.edit).toBe(CHEAP);
    expect(TIER_DEFAULTS.chat).toBe(CHEAP);
    expect(TIER_DEFAULTS.review).toBe(CHEAP);
    expect(TIER_DEFAULTS.cheap).toBe(CHEAP);
  });

  it("does not let MODEL_BUILD reach the design or blueprint tiers", async () => {
    const { TIER_DEFAULTS } = await loadTiers({ MODEL_BUILD: STRONG });

    expect(TIER_DEFAULTS.build).toBe(STRONG);
    expect(TIER_DEFAULTS.design).toBe(CHEAP);
    expect(TIER_DEFAULTS.plan).toBe(CHEAP);
  });

  it("lets MODEL_PLAN override the blueprint without moving design", async () => {
    const { TIER_DEFAULTS } = await loadTiers({
      MODEL_DESIGN: STRONG,
      MODEL_PLAN: "gpt-5.6-terra",
    });

    expect(TIER_DEFAULTS.plan).toBe("gpt-5.6-terra");
    expect(TIER_DEFAULTS.design).toBe(STRONG);
  });

  it("falls back through OPENAI_MODEL_GEN then OPENAI_MODEL_SMART for design", async () => {
    const viaGen = await loadTiers({ OPENAI_MODEL_GEN: "gpt-5.6-terra" });
    expect(viaGen.TIER_DEFAULTS.design).toBe("gpt-5.6-terra");

    const viaSmart = await loadTiers({ OPENAI_MODEL_SMART: "gpt-5.6-sol" });
    expect(viaSmart.TIER_DEFAULTS.design).toBe("gpt-5.6-sol");
  });

  it("defaults every tier to the cheap model when nothing is configured", async () => {
    // loadTiers() blanks every model variable rather than deleting it, which is
    // what Vercel leaves behind when a value is cleared — a blank variable must
    // read as unset, not as a model id of "".
    const { TIER_DEFAULTS } = await loadTiers({});
    for (const model of Object.values(TIER_DEFAULTS)) expect(model).toBe(CHEAP);
  });

  it("treats a whitespace-only variable as unset", async () => {
    const { TIER_DEFAULTS } = await loadTiers({ MODEL_DESIGN: "   " });
    expect(TIER_DEFAULTS.design).toBe(CHEAP);
  });
});

describe("pickModel", () => {
  it("never lets a project's build override become its blueprint model", async () => {
    const { pickModel, TIER_DEFAULTS } = await loadTiers({ MODEL_DESIGN: STRONG });

    // The old code read cfg.build when cfg.plan was empty.
    expect(pickModel({ build: "gpt-5.6-sol" }, "plan")).toBe(TIER_DEFAULTS.plan);
    expect(pickModel({ build: "gpt-5.6-sol" }, "design")).toBe(STRONG);
    expect(pickModel({ build: "gpt-5.6-sol" }, "build")).toBe("gpt-5.6-sol");
  });

  it("uses a tier's own override and trims it", async () => {
    const { pickModel } = await loadTiers({ MODEL_DESIGN: STRONG });
    expect(pickModel({ design: "  gpt-5.6-terra  " }, "design")).toBe("gpt-5.6-terra");
  });

  it("ignores blank, non-string and missing config", async () => {
    const { pickModel, TIER_DEFAULTS } = await loadTiers({ MODEL_DESIGN: STRONG });

    for (const cfg of [null, undefined, "nonsense", 7, { design: "   " }, { design: 3 }]) {
      expect(pickModel(cfg, "design")).toBe(TIER_DEFAULTS.design);
    }
  });
});
