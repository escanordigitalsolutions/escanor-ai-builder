import { generateText } from "@/lib/ai/provider";
import { pickModel } from "@/lib/ai/resolve";

import type { EditedFile } from "./edit-output";

/**
 * A second pair of eyes on an edit, before the user is offered an Undo.
 *
 * Until now the pipeline ended at the write. WordPress refuses invalid PHP and
 * (since 1.27) malformed CSS, so a broken file cannot land — but nothing asked
 * the only question that matters to the person who asked for the change: did it
 * do what they wanted, and did it break something two sections down?
 *
 * Deliberately cheap and deliberately quiet. It runs on the cheap tier, reads
 * only the files that changed, and is worth saying out loud only when it finds
 * something. A review that comments on every edit is a review nobody reads.
 */

const INSTRUCTIONS = `You are reviewing one edit to a classic PHP WordPress theme, already written to disk.

You are given the request and the new contents of every file that changed. Judge two things only:
1. Does the change do what the request asked?
2. Did it obviously break something — a missing closing tag or brace, a function called that is not defined here, a class or CSS variable used that nothing defines, markup left unclosed, copy changed that the request did not ask to change.

You cannot see the files that did NOT change, so never report something as missing just because you cannot see where it is defined — say it only when the changed file itself should have defined it.

Answer in exactly this shape, nothing else:

VERDICT: ok
or
VERDICT: problem
NOTE: <one sentence, plain language, addressed to the site owner>

Use "problem" only for something you can point at in the text you were given. Anything you are unsure about is "ok".`;

export type EditReview = {
  ok: boolean;
  /** One sentence, only when something was found. */
  note: string;
};

/** Above this the review costs more than it is worth; the edit stands unreviewed. */
const MAX_REVIEW_CHARS = 80_000;

export function parseReview(text: string): EditReview {
  const verdict = /VERDICT:\s*(ok|problem)/i.exec(text);

  if (!verdict || verdict[1].toLowerCase() === "ok") return { ok: true, note: "" };

  const note = /NOTE:\s*(.+)/i.exec(text);

  // "problem" with nothing to say is not a problem anyone can act on.
  if (!note || !note[1].trim()) return { ok: true, note: "" };

  return { ok: false, note: note[1].trim().slice(0, 300) };
}

export async function reviewEdit(options: {
  modelConfig: unknown;
  instruction: string;
  files: EditedFile[];
  timeoutMs?: number;
}): Promise<EditReview> {
  const { modelConfig, instruction, files } = options;

  if (files.length === 0) return { ok: true, note: "" };

  const total = files.reduce((sum, file) => sum + file.contents.length, 0);

  if (total > MAX_REVIEW_CHARS) return { ok: true, note: "" };

  const body = files
    .map((file) => `--- ${file.path} ---\n${file.contents}`)
    .join("\n\n");

  try {
    const out = await generateText({
      model: pickModel(modelConfig, "cheap"),
      system: INSTRUCTIONS,
      input: `REQUEST:\n${instruction}\n\nFILES AFTER THE EDIT:\n\n${body}`,
      maxTokens: 600,
      timeoutMs: options.timeoutMs ?? 45_000,
    });

    return parseReview(out.text);
  } catch {
    // The edit is already written and valid. A review that could not run is a
    // missing opinion, not a reason to alarm anyone.
    return { ok: true, note: "" };
  }
}
