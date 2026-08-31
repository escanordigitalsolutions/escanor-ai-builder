/**
 * How much past conversation is replayed.
 *
 * A message count alone is the wrong unit: sixteen one-line exchanges cost
 * nothing, while sixteen answers containing file listings do not fit usefully
 * in a request that already carries the whole theme. Budget by size, and keep
 * the oldest surviving user message whatever happens — it usually holds the
 * intent every later message assumes.
 */
export const HISTORY_MAX_MESSAGES = 16;
export const HISTORY_MAX_CHARS = 24_000;

export function budgetHistory<T extends { role: "user" | "assistant"; content: string }>(
  rows: T[]
): T[] {
  const kept: T[] = [];
  let used = 0;

  // Newest first: the most recent turns are the ones worth their space.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];

    if (used + row.content.length > HISTORY_MAX_CHARS && kept.length > 0) break;

    kept.unshift(row);
    used += row.content.length;
  }

  const firstUser = rows.find((row) => row.role === "user");

  if (firstUser && !kept.includes(firstUser)) {
    kept.unshift(firstUser);
  }

  return kept;
}
