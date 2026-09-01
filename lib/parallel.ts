/**
 * Running independent work together, without a dependency.
 *
 * Lifted out of the design route because a route file cannot export anything
 * but its handler, and this is the piece the whole redesign rests on: the pages
 * of a site are independent of each other, so generating them one after another
 * was costing minutes for nothing. Getting the concurrency wrong is not a
 * visible bug — it is a silently sequential run, or a rate limit that fails a
 * generation that had already succeeded — so it is worth being able to test.
 */

/**
 * Run a job over each item, at most `limit` at a time, keeping input order.
 *
 * Promise.all over everything would send the whole set at once; a for-loop
 * sends one. This is the middle, and it is written here rather than pulled in
 * because it is eleven lines and the alternative is a dependency.
 */
export async function inParallel<T, R>(
  items: readonly T[],
  limit: number,
  job: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await job(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  );

  return out;
}
