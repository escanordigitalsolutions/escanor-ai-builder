import { BUILD_MODEL, GEN_MODEL, FAST_MODEL, SMART_MODEL } from "./models";

/**
 * Per-project model selection.
 *
 * A project can override the model used for each tier, stored in the
 * projects.model_config JSONB column (set from the dashboard). When a tier has
 * no per-project override, the environment default for that tier is used.
 *
 *   plan   — the creative step: blueprint + design identity (build-plan).
 *            Use the strongest model here; it falls back to the build tier.
 *   build  — file generation (build-files) — mechanical, cheap models do fine
 *   edit   — chat edits + design elevation (edit-theme, design-plan)
 *   chat   — the AI Editor conversation (chat)
 *   review — the correctness pass (review-theme)
 */

export type ModelTier = "plan" | "build" | "edit" | "chat" | "review";

export const TIER_DEFAULTS: Record<ModelTier, string> = {
  plan: process.env.MODEL_PLAN ?? BUILD_MODEL,
  build: BUILD_MODEL,
  edit: GEN_MODEL,
  chat: FAST_MODEL,
  review: SMART_MODEL,
};

/** Resolve a tier's model from a project's model_config (env fallback). */
export function pickModel(modelConfig: unknown, tier: ModelTier): string {
  const cfg =
    modelConfig && typeof modelConfig === "object"
      ? (modelConfig as Record<string, unknown>)
      : {};
  const read = (key: string): string => {
    const v = cfg[key];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  };
  // "plan" inherits the project's build override when it has no own override,
  // so existing projects keep behaving the same until a plan model is chosen.
  const chosen = read(tier) || (tier === "plan" ? read("build") : "");
  return chosen || TIER_DEFAULTS[tier];
}
