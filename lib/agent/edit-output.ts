/**
 * Reading what the edit model wrote.
 *
 * Two shapes are accepted, and the difference is cost.
 *
 * A whole file is the honest way to restructure something, but it makes the
 * model reproduce every byte it is not changing: a one-line change to a 38 KB
 * stylesheet costs 38 KB of output tokens, takes as long, and is the reason a
 * reply can run into the token ceiling and end mid-file.
 *
 * An anchored edit says "find exactly this, put exactly that in its place".
 * The site already sent us the file, so the replacement happens here and
 * WordPress still receives whole files — the protocol between the two is
 * unchanged. An anchor that does not match, or matches twice, is refused
 * rather than guessed at.
 */

export type EditedFile = { path: string; contents: string };
export type AnchoredEdit = { path: string; find: string; replace: string };

export type ParsedEditOutput = {
  summary: string;
  files: EditedFile[];
  anchors: AnchoredEdit[];
};

/** Cheap models wrap file contents in markdown fences; real files never have them. */
function stripFences(text: string): string {
  return text
    .replace(/^\s*```[a-zA-Z0-9_-]*\s*\r?\n/, "")
    .replace(/\r?\n```\s*$/, "");
}

function cleanPath(raw: string): string {
  return raw.trim().replace(/^`+|`+$/g, "");
}

export function parseEditOutput(text: string): ParsedEditOutput {
  const files: EditedFile[] = [];
  const anchors: AnchoredEdit[] = [];

  // Split on the FILE marker so a missing or malformed ===WPAB_END=== cannot
  // merge two files into one; each file's content runs to the next marker.
  const parts = text.split(/===\s*WPAB_FILE\s*:/);

  for (let i = 1; i < parts.length; i++) {
    const head = parts[i].match(/^\s*([^\n=]+?)\s*===\s*\r?\n?([\s\S]*)$/);
    if (!head) continue;

    const path = cleanPath(head[1]);
    if (!path) continue;

    let contents = head[2].replace(/^﻿/, "");
    // Anything after the end marker belongs to the next block, not this file.
    contents = contents.replace(/\n?===\s*WPAB_(?:END|EDIT|FILE)\b[\s\S]*$/, "");
    contents = stripFences(contents);

    files.push({ path, contents: `${contents.replace(/\s+$/, "")}\n` });
  }

  const anchorParts = text.split(/===\s*WPAB_EDIT\s*:/);

  for (let i = 1; i < anchorParts.length; i++) {
    const head = anchorParts[i].match(/^\s*([^\n=]+?)\s*===\s*\r?\n([\s\S]*)$/);
    if (!head) continue;

    const path = cleanPath(head[1]);
    if (!path) continue;

    const body = head[2].replace(/\n?===\s*WPAB_(?:END|EDIT|FILE)\b[\s\S]*$/, "");
    const pair = body.match(
      /^\s*---\s*FIND\s*---\r?\n([\s\S]*?)\r?\n---\s*REPLACE\s*---\r?\n([\s\S]*)$/
    );

    if (!pair) continue;

    const find = pair[1];
    const replace = pair[2].replace(/\s+$/, "");

    // An empty anchor would match everywhere; refusing it here is simpler than
    // explaining a mangled file later.
    if (!find.trim()) continue;

    anchors.push({ path, find, replace });
  }

  const summary = text.match(/SUMMARY:\s*(.+)/);

  return {
    summary: summary ? summary[1].trim() : "Updated the theme.",
    files,
    anchors,
  };
}

export type AnchorResult = {
  files: EditedFile[];
  /** Anchors that could not be applied, phrased for the person who asked. */
  errors: string[];
};

/**
 * Apply anchored edits against the files as they are now.
 *
 * `read` returns the current contents of a path, or undefined when the file is
 * not in the snapshot. Several anchors may target the same file; they are
 * applied in order, each against the result of the last, so a later anchor can
 * legitimately match text an earlier one wrote.
 */
export function applyAnchoredEdits(
  anchors: AnchoredEdit[],
  read: (path: string) => string | undefined
): AnchorResult {
  const working = new Map<string, string>();
  const errors: string[] = [];

  for (const anchor of anchors) {
    const current = working.get(anchor.path) ?? read(anchor.path);

    if (current === undefined) {
      errors.push(`${anchor.path} is not part of this theme, so it was not changed.`);
      continue;
    }

    const first = current.indexOf(anchor.find);

    if (first === -1) {
      errors.push(
        `The text to replace was not found in ${anchor.path}. Nothing was changed there.`
      );
      continue;
    }

    if (current.indexOf(anchor.find, first + 1) !== -1) {
      // Picking one occurrence would be a coin flip on which part of the page
      // changes. Better to say so and let the instruction be more specific.
      errors.push(
        `The text to replace appears more than once in ${anchor.path}, so it was left alone.`
      );
      continue;
    }

    working.set(
      anchor.path,
      current.slice(0, first) + anchor.replace + current.slice(first + anchor.find.length)
    );
  }

  return {
    files: [...working.entries()].map(([path, contents]) => ({ path, contents })),
    errors,
  };
}

/**
 * Merge whole-file rewrites with the results of anchored edits.
 *
 * A whole file wins: if the model both rewrote a file and anchored into it,
 * the rewrite is the more deliberate statement of what it wants the file to be.
 */
export function mergeEditedFiles(
  whole: EditedFile[],
  anchored: EditedFile[]
): EditedFile[] {
  const byPath = new Map<string, EditedFile>();

  for (const file of anchored) byPath.set(file.path, file);
  for (const file of whole) byPath.set(file.path, file);

  return [...byPath.values()];
}
