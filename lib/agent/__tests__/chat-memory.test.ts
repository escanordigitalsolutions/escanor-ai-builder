import { describe, expect, it } from "vitest";

import {
  MEMORY_MAX_CHARS,
  MEMORY_MAX_ITEMS,
  memoryBlock,
  parseMemory,
} from "../chat-memory";

/**
 * The memory is written by a cheap model and shown to the person as chips, so
 * both halves matter: it must survive a model that returns nonsense, and it
 * must stay short enough that anybody actually reads it.
 */
describe("parseMemory", () => {
  it("keeps a plain list in order", () => {
    expect(parseMemory(["accent is #3d64f2", "keep the footer"])).toEqual([
      "accent is #3d64f2",
      "keep the footer",
    ]);
  });

  it("ignores anything that is not a list of strings", () => {
    expect(parseMemory(null)).toEqual([]);
    expect(parseMemory("accent is blue")).toEqual([]);
    expect(parseMemory([1, {}, null, "real"])).toEqual(["real"]);
    expect(parseMemory(["", "   "])).toEqual([]);
  });

  it("does not let one decision occupy two chips", () => {
    expect(parseMemory(["Accent is blue", "accent is blue"])).toEqual(["Accent is blue"]);
  });

  it("stays short", () => {
    const many = Array.from({ length: MEMORY_MAX_ITEMS + 5 }, (_, i) => `item ${i}`);

    expect(parseMemory(many)).toHaveLength(MEMORY_MAX_ITEMS);
    expect(parseMemory(["x".repeat(500)])[0]).toHaveLength(MEMORY_MAX_CHARS);
  });
});

describe("memoryBlock", () => {
  it("adds nothing to the prompt when there is nothing to add", () => {
    expect(memoryBlock([])).toBe("");
  });

  it("lists the items and says what they are for", () => {
    const block = memoryBlock(["accent is #3d64f2", "keep the footer"]);

    expect(block).toContain("- accent is #3d64f2");
    expect(block).toMatch(/do not ask again/);
    expect(block.startsWith("\n\n")).toBe(true);
  });
});
