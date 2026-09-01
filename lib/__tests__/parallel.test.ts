import { describe, expect, it } from "vitest";

import { inParallel } from "@/lib/parallel";

/**
 * The design stage generates a site's pages together rather than one after
 * another, which is what made a site of eight real pages affordable in the
 * first place. Getting this wrong is invisible from the outside: a run that is
 * quietly sequential still succeeds, just minutes later and with half its pages
 * dropped for time. So the two properties that matter — the order comes back
 * unchanged, and no more than `limit` are ever in flight — are asserted rather
 * than assumed.
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("inParallel", () => {
  it("returns results in input order however the jobs finish", async () => {
    const out = await inParallel([50, 10, 30, 5, 40], 3, async (ms) => {
      await wait(ms);
      return ms;
    });

    expect(out).toEqual([50, 10, 30, 5, 40]);
  });

  it("never runs more than the limit at once", async () => {
    let live = 0;
    let peak = 0;

    await inParallel(Array.from({ length: 9 }, (_, i) => i), 3, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await wait(15);
      live -= 1;
      return null;
    });

    expect(peak).toBe(3);
  });

  it("really does run them together", async () => {
    const started = Date.now();

    await inParallel([1, 2, 3], 3, async () => {
      await wait(60);
      return null;
    });

    // Sequentially this is 180ms. The margin is generous because a loaded CI
    // box is slow, but not so generous that a sequential run would pass.
    expect(Date.now() - started).toBeLessThan(150);
  });

  it("runs every item exactly once", async () => {
    const seen: number[] = [];

    await inParallel([0, 1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      seen.push(n);
      return n;
    });

    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("copes with fewer items than workers, and with none", async () => {
    expect(await inParallel([7], 3, async (n) => n * 2)).toEqual([14]);
    expect(await inParallel([], 3, async (n) => n)).toEqual([]);
  });

  it("makes progress on a limit of zero instead of hanging forever", async () => {
    expect(await inParallel([1, 2], 0, async (n) => n)).toEqual([1, 2]);
  });
});
