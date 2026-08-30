/**
 * What stage Meikero is at, and what that means.
 *
 * Two version lines exist and they answer different questions.
 *
 * The SaaS version is the product's: it is at 0.x because nothing has been
 * promised to anyone yet, and reaches 1.0.0 when signup opens to the public.
 *
 * The plugin's version is a compatibility number for WordPress, not a claim
 * about the product's maturity. It is already at 1.18.x and must keep climbing:
 * WordPress compares versions to decide whether to offer an update, so
 * renumbering it downward would strand every installed copy on the version it
 * has, with no way to reach it again.
 *
 * The stage is shown in the interface on purpose. A person handing over a card
 * is entitled to know they are early.
 */

export type ReleaseStage = "alpha" | "private-beta" | "beta" | "stable";

export const RELEASE = {
  /** The SaaS product version. 1.0.0 when signup opens to everyone. */
  version: "0.9.0",

  stage: "private-beta" as ReleaseStage,

  /** Shown as a chip beside the wordmark. Empty at "stable". */
  label: "Beta",

  /** One line, for a tooltip. */
  note: "Meikero is in private beta — invited accounts only, and things may still change.",
} as const;

export function showsStageChip(): boolean {
  return RELEASE.stage !== "stable" && RELEASE.label.length > 0;
}
