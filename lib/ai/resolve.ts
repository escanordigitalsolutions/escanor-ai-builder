import { BUILD_MODEL, GEN_MODEL, FAST_MODEL, SMART_MODEL } from "./models";

/**
 * Per-project model selection.
 *
 * A project can override the model used for each tier, stored in the
 * projects.model_config JSONB column (set from the dashboard). When a tier has
 * no per-project override, the environment default for that tier is used.
 *
 *   build  — theme generation (build-plan, build-files) — provider-agnostic
 *   edit   — chat edits + design elevation (edit-theme, design-plan)
 *   chat   — the AI Editor conversation (chat)
 *   review — the correctness pass (review-theme)
 */

export type ModelTier = "build" | "edit" | "chat" | "review";

export const TIER_DEFAULTS: Record<ModelTier, string> = {
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
  const v = cfg[tier];
  return typeof v === "string" && v.trim() ? v.trim() : TIER_DEFAULTS[tier];
}
