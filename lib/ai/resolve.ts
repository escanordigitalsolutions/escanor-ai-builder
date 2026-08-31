import { BUILD_MODEL, DESIGN_MODEL, SMART_MODEL, envModel } from "./models";

/**
 * Per-project model selection.
 *
 * A project can override the model used for each tier, stored in the
 * projects.model_config JSONB column (set from the dashboard). When a tier has
 * no per-project override, the environment default for that tier is used.
 *
 * The split that matters for cost: the two CREATIVE tiers decide what the theme
 * looks like and run a handful of times per theme, so they carry the strong
 * model. Everything after them is mechanical and high-volume, so it stays on the
 * cheap model. No mechanical tier inherits from a creative one — that leak is
 * what silently put file generation on Sonnet.
 *
 *   plan   — the blueprint: section-by-section structure (build-plan). CREATIVE.
 *   design — art direction + the homepage designer (mockup-core).  CREATIVE.
 *   build  — file generation (build-files): porting a decided design into PHP
 *            and CSS. Dozens of calls per theme; a cheap model does fine.
 *   edit   — chat edits + design elevation (edit-theme, design-plan)
 *   chat   — the AI Editor conversation (chat)
 *   review — the correctness pass (review-theme)
 *   cheap  — supporting design pages (inner, components, archive, 404), the
 *            design critique, page content and edit planning.
 */

export type ModelTier =
  | "plan"
  | "design"
  | "build"
  | "edit"
  | "chat"
  | "review"
  | "cheap";

export const TIER_DEFAULTS: Record<ModelTier, string> = {
  // The creative pair. Both default to DESIGN_MODEL (MODEL_DESIGN), so setting
  // one environment variable puts the strong model exactly where it earns its
  // price and nowhere else.
  plan: envModel("MODEL_PLAN") ?? DESIGN_MODEL,
  design: DESIGN_MODEL,
  // Mechanical. BUILD_MODEL defaults to the cheap OpenAI model and does NOT
  // follow the design model.
  build: BUILD_MODEL,
  // Edits and chat default to the cheap OpenAI model — many small tool-loop
  // steps are cheap there; override per project or with MODEL_EDIT/MODEL_CHAT.
  edit: envModel("MODEL_EDIT") ?? "gpt-5.6-luna",
  chat: envModel("MODEL_CHAT") ?? "gpt-5.6-luna",
  review: SMART_MODEL,
  // Cheap helper steps (supporting design pages, quick design review, page
  // content). Defaults to OpenAI's gpt-5.6-luna; override with MODEL_CHEAP.
  cheap: envModel("MODEL_CHEAP") ?? "gpt-5.6-luna",
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
  // Every tier reads only its own override. "plan" used to fall back to the
  // project's "build" override, which meant a per-project build model quietly
  // became the blueprint model too (and, through the environment, the reverse:
  // a strong plan model dragged file generation up with it). Tiers are
  // independent now — an empty override means the environment default.
  return read(tier) || TIER_DEFAULTS[tier];
}
