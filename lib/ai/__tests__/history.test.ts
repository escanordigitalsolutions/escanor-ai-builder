import { describe, expect, it } from "vitest";

import { HISTORY_MAX_CHARS, budgetHistory } from "../history";

type Turn = { role: "user" | "assistant"; content: string };

const turn = (role: Turn["role"], content: string): Turn => ({ role, content });

describe("budgetHistory", () => {
  it("keeps a short conversation whole and in order", () => {
    const rows: Turn[] = [
      turn("user", "what does header.php do"),
      turn("assistant", "it opens every page"),
      turn("user", "and the footer"),
    ];

    expect(budgetHistory(rows)).toEqual(rows);
  });

  it("drops the oldest middle turns when the budget runs out", () => {
    const big = "x".repeat(HISTORY_MAX_CHARS / 2);
    const rows: Turn[] = [
      turn("user", "make the hero green"),
      turn("assistant", big),
      turn("assistant", big),
      turn("user", "and the buttons"),
    ];

    const kept = budgetHistory(rows);

    // The newest turns survive, the oldest bulk does not.
    expect(kept.at(-1)!.content).toBe("and the buttons");
    expect(kept.length).toBeLessThan(rows.length);
  });

  it("always keeps the first user message", () => {
    const intent = turn("user", "we are rebuilding the pricing page");
    const rows: Turn[] = [
      intent,
      ...Array.from({ length: 8 }, () => turn("assistant", "y".repeat(HISTORY_MAX_CHARS / 3))),
      turn("user", "now the footer"),
    ];

    const kept = budgetHistory(rows);

    // Without this, a long conversation silently loses what it is about.
    expect(kept[0]).toBe(intent);
    expect(kept.at(-1)!.content).toBe("now the footer");
  });

  it("never returns nothing, even for one oversized turn", () => {
    const rows: Turn[] = [turn("assistant", "z".repeat(HISTORY_MAX_CHARS * 3))];

    expect(budgetHistory(rows)).toHaveLength(1);
  });

  it("handles an empty conversation", () => {
    expect(budgetHistory([])).toEqual([]);
  });

  it("does not duplicate the first user message when it already fits", () => {
    const rows: Turn[] = [turn("user", "hello"), turn("assistant", "hi")];
    const kept = budgetHistory(rows);

    expect(kept.filter((row) => row.content === "hello")).toHaveLength(1);
  });
});
