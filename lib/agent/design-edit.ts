import { generateText } from "@/lib/ai/provider";
import { pickModel } from "@/lib/ai/resolve";
import type { Usage } from "@/lib/ai/provider";

import { applyAnchoredEdits, parseEditOutput } from "./edit-output";

/**
 * Adjusting an approved design before anything is built from it.
 *
 * Until now a design was take-it-or-regenerate: the only way to change anything
 * was another full generation, at roughly fifty credits, with a different
 * result rather than the same one adjusted. That makes the design a lottery
 * ticket instead of something you work on.
 *
 * The mechanism is the anchored edit already used on theme files — find exactly
 * this, put exactly that — applied to the mockup's own HTML. It costs one cheap
 * call, it cannot rewrite the page behind your back, and an anchor that does
 * not match is refused rather than guessed at.
 */

const INSTRUCTIONS = `You are adjusting a homepage design that has already been approved. The person is looking at it and has asked for one change.

Change what was asked and nothing else. This is not a redesign: the palette, the typefaces, the grid and the structural idea stay exactly as they are unless the request is specifically about them. A request to make the hero smaller is not permission to rewrite the hero's copy.

Rules:
1. Reply with anchored edits. Each block finds text copied from the document character for character — including indentation — and gives what it becomes.
2. The FIND text must appear exactly once. If it would appear twice, include a surrounding line to make it unique.
3. Prefer the smallest edit that does the job. Several small anchors beat one large one.
4. Every colour, size and spacing goes through the existing custom properties. Do not introduce a hex value or a font that is not already in :root.
5. Copy is only changed when the request asks for a copy change, and then in the exact words given.
6. If the request cannot be done safely from this document, return no blocks and say why in SUMMARY.

Format — one block per change, as many as the change needs:

SUMMARY: <what changed, in one sentence, addressed to the person>

===WPAB_EDIT:home===
---FIND---
<text exactly as it appears>
---REPLACE---
<what it becomes>
===WPAB_END===`;

/** The one virtual path the anchors address. */
const DOCUMENT = "home";

export type DesignEditResult = {
  html: string;
  summary: string;
  /** Anchors that could not be applied, phrased for the person who asked. */
  notes: string[];
  changed: boolean;
  usage: Usage;
  model: string;
};

export async function editDesign(options: {
  modelConfig: unknown;
  html: string;
  instruction: string;
  timeoutMs?: number;
}): Promise<DesignEditResult> {
  const { modelConfig, html, instruction } = options;
  const model = pickModel(modelConfig, "edit");

  const gen = await generateText({
    model,
    system: INSTRUCTIONS,
    maxTokens: 16000,
    timeoutMs: options.timeoutMs ?? 180_000,
    input: `THE REQUEST\n${instruction}\n\nTHE DESIGN (${DOCUMENT})\n${html}`,
  });

  const parsed = parseEditOutput(gen.text);
  const applied = applyAnchoredEdits(
    // The model is asked for one document; anything else it names is a mistake
    // worth reporting rather than a file to go looking for.
    parsed.anchors.map((anchor) => ({ ...anchor, path: DOCUMENT })),
    (path) => (path === DOCUMENT ? html : undefined)
  );

  const next = applied.files.find((file) => file.path === DOCUMENT);

  return {
    html: next?.contents ?? html,
    summary: parsed.summary,
    notes: applied.errors,
    changed: Boolean(next) && !gen.truncated,
    usage: gen.usage,
    model,
  };
}

/**
 * Put the homepage's stylesheet back into a screen that borrows it.
 *
 * Every derived screen carries the homepage CSS in a <style data-part="base">
 * block and its own rules in a second block. Editing the homepage therefore
 * changes four other screens too — and leaving them on the old stylesheet is
 * how a design ends up looking edited on one page and not the others.
 *
 * The brand sheet has no such block: it is rendered deterministically rather
 * than by a model, so it is left alone and the caller says so.
 */
export function syncBaseCss(screenHtml: string, css: string): string {
  if (!screenHtml || !css || css.includes("</style")) return screenHtml;

  const block = /(<style[^>]*data-part=["']base["'][^>]*>)([\s\S]*?)(<\/style>)/i;

  return block.test(screenHtml)
    ? screenHtml.replace(block, (_m, open: string, _old: string, close: string) => open + css + close)
    : screenHtml;
}

/** True when a screen borrows the homepage stylesheet at all. */
export function borrowsBaseCss(screenHtml: string): boolean {
  return /<style[^>]*data-part=["']base["']/i.test(screenHtml ?? "");
}
