import { describe, expect, it } from "vitest";

import { coverPrompt, renderCover } from "@/lib/agent/cover";
import { parseArtDirection } from "@/lib/agent/art-direction";

/**
 * The cover painter's brief, and the one behaviour that must hold without a
 * network: no key, no direction — no cover, never an exception. The painting
 * itself cannot be asserted; what it is asked for can be.
 */

const direction = parseArtDirection(
  JSON.stringify({
    concept: { name: "Bench Signal", thesis: "Repair as a precise diagnostic act.", rootedIn: "r" },
    signatureMove: "one vertical trace the page hangs from",
    tokens: {
      color: {
        ground: "#F3F1EC", surface: "#FFFFFF", ink: "#1A1712", "ink-2": "#4A4438",
        muted: "#8A8272", line: "#DDD8CC", accent: "#B4381F", "accent-ink": "#FFFDF8",
      },
      font: { display: "Fraunces", text: "Karla" },
      size: ["1", "2", "3", "4", "5", "6", "7"],
      space: ["1", "2", "3", "4", "5", "6", "7"],
      radius: ["0", "2px", "0"],
      motion: { duration: "200ms", easing: "ease" },
    },
    typography: {
      display: { family: "Fraunces", url: "https://fonts.googleapis.com/css2?family=Fraunces&display=swap", weights: [400] },
      text: { family: "Karla", url: "https://fonts.googleapis.com/css2?family=Karla&display=swap", weights: [400] },
      pairing: "Serif display against a humanist sans",
    },
    palette: { rationale: "r", unusualChoice: "u" },
    layout: { grid: "g", rhythm: "r", sections: [] },
    imagery: { strategy: "typographic", treatment: "", queries: [] },
    motion: "m",
    voice: { tone: "dry, workshop-plain", sample: { h1: "a", sub: "b", cta: "c" } },
    avoid: [],
    colorways: [],
  })
)!;

describe("coverPrompt", () => {
  const prompt = coverPrompt(direction, "Bench Signal");

  it("carries the actual palette, as hex the painter can be held to", () => {
    // parseArtDirection normalises hex to lowercase, and lowercase binds a
    // painter exactly as well.
    for (const hex of ["#f3f1ec", "#1a1712", "#b4381f"]) {
      expect(prompt).toContain(hex);
    }
  });

  it("carries the concept, the mood and the signature structure", () => {
    expect(prompt).toContain("Bench Signal");
    expect(prompt).toContain("precise diagnostic act");
    expect(prompt).toContain("dry, workshop-plain");
    expect(prompt).toContain("one vertical trace");
  });

  it("forbids the things that would make it a fake screenshot", () => {
    // The cover is atmosphere. Text or UI in it would read as a page that
    // does not exist — the exact trap the truthful thumbnail avoids.
    expect(prompt).toContain("No text");
    expect(prompt).toContain("no user interface");
    expect(prompt).toContain("no screenshots");
  });

  it("still reads as a brief when the direction is sparse", () => {
    const sparse = coverPrompt(
      { ...direction, signatureMove: "", voice: { ...direction.voice, tone: "" } },
      "X"
    );

    expect(sparse).toContain("a strong vertical rhythm");
    expect(sparse).toContain("confident, considered");
  });
});

describe("renderCover", () => {
  it("declines quietly with no direction or no key", async () => {
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      expect(await renderCover(null, "X")).toBeNull();
      expect(await renderCover(direction, "X")).toBeNull();
    } finally {
      if (key !== undefined) process.env.OPENAI_API_KEY = key;
    }
  });
});
