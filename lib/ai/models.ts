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

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.6";

export const FAST_MODEL = process.env.OPENAI_MODEL_FAST ?? DEFAULT_MODEL;
export const SMART_MODEL = process.env.OPENAI_MODEL_SMART ?? DEFAULT_MODEL;
