/**
 * Central OpenAI model selection.
 *
 * Cost control lever: read-only work (chat, project inspection) does not need
 * the strongest model, while change-proposal generation does. Splitting the two
 * lets a cheaper model absorb the high-volume, low-stakes traffic.
 *
 *   FAST_MODEL   — chat + project inspection (high volume, read-only)
 *   SMART_MODEL  — change-proposal generation (writes real code)
 *
 * Both fall back to OPENAI_MODEL and then a hard default, so behaviour does not
 * change until the cheaper/stronger model names are set in the environment.
 * Set OPENAI_MODEL_FAST to a cheaper model to actually reduce spend.
 */

/**
 * Read a model id from the environment.
 *
 * A variable that exists but is blank means "not configured" here. Vercel keeps
 * an emptied variable in the list rather than removing it, and `??` would hand
 * that empty string straight to the API as a model id.
 */
export function envModel(name: string): string | undefined {
  const raw = process.env[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  return value || undefined;
}

const DEFAULT_MODEL = envModel("OPENAI_MODEL") ?? "gpt-5.6-luna";

export const FAST_MODEL = envModel("OPENAI_MODEL_FAST") ?? DEFAULT_MODEL;
export const SMART_MODEL = envModel("OPENAI_MODEL_SMART") ?? DEFAULT_MODEL;

/**
 * GEN_MODEL — the theme GENERATION + design tier (build-plan, build-files,
 * design-plan). This is the heaviest, most quality-sensitive work, so it gets
 * its own lever: set OPENAI_MODEL_GEN to try a different model (e.g. the "Terra"
 * model — use its exact id, e.g. gpt-5.6-terra) on generation ONLY, without
 * touching chat, edits or the correctness review. Falls back to SMART_MODEL, so
 * nothing changes until OPENAI_MODEL_GEN is set in the environment.
 */
export const GEN_MODEL = envModel("OPENAI_MODEL_GEN") ?? SMART_MODEL;

/**
 * DESIGN_MODEL — the two creative decisions: the art direction and the homepage
 * designer, plus the blueprint. This is the ONLY place a strong (expensive)
 * model belongs; everything downstream of it is mechanical. Set MODEL_DESIGN to
 * a Claude id (e.g. claude-sonnet-5) to run the creative steps on Claude while
 * file generation, chat, edits and review stay on the cheap OpenAI model.
 * Falls back to GEN_MODEL, then SMART_MODEL, then the default.
 */
export const DESIGN_MODEL = envModel("MODEL_DESIGN") ?? GEN_MODEL;

/**
 * BUILD_MODEL — file generation (build-files). This is mechanical porting work:
 * the blueprint and the design are already decided by DESIGN_MODEL, so a cheap
 * model does it just as well and it is the highest-volume tier by far (dozens of
 * calls per theme). It deliberately does NOT inherit the design model — set
 * MODEL_BUILD only to override the cheap default.
 */
export const BUILD_MODEL = envModel("MODEL_BUILD") ?? DEFAULT_MODEL;
