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

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";

export const FAST_MODEL = process.env.OPENAI_MODEL_FAST ?? DEFAULT_MODEL;
export const SMART_MODEL = process.env.OPENAI_MODEL_SMART ?? DEFAULT_MODEL;

/**
 * GEN_MODEL — the theme GENERATION + design tier (build-plan, build-files,
 * design-plan). This is the heaviest, most quality-sensitive work, so it gets
 * its own lever: set OPENAI_MODEL_GEN to try a different model (e.g. the "Terra"
 * model — use its exact id, e.g. gpt-5.6-terra) on generation ONLY, without
 * touching chat, edits or the correctness review. Falls back to SMART_MODEL, so
 * nothing changes until OPENAI_MODEL_GEN is set in the environment.
 */
export const GEN_MODEL = process.env.OPENAI_MODEL_GEN ?? SMART_MODEL;
