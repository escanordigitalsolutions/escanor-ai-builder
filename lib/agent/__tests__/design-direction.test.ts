import { describe, it, expect } from "vitest";

import {
  contrastRatio,
  ensureContrast,
  parseArtDirection,
  readRootTokens,
  resolveShape,
  serialiseTokens,
} from "@/lib/agent/art-direction";
import {
  repairMockup,
  retryNote,
  validateMockup,
} from "@/lib/agent/validate-mockup";

/**
 * The design pipeline's pure logic.
 *
 * Written because two of these assertions failed the first time they were run,
 * on code that `tsc` and `eslint` had both passed: colours came out of the
 * parser in two different spellings, and the font-link repair searched the
 * whole document — finding the family name inside the token block itself and
 * concluding the stylesheet was already linked. That repair would never have
 * fired in production, and nothing would have reported it.
 *
 * Every test here runs in milliseconds and calls no model.
 */

/** A plausible art-director reply, deliberately imperfect in three ways. */
const REPLY = JSON.stringify({
  concept: {
    name: "Proof",
    thesis: "The page behaves like a press sheet.",
    rootedIn: "They still print letterpress.",
  },
  signatureMove: "One continuous vertical rule the whole page hangs from.",
  tokens: {
    // shorthand hex, which must be normalised
    color: {
      ground: "#FFF",
      surface: "#f3f1ec",
      ink: "#1a1712",
      "ink-2": "#4a4438",
      muted: "#8a8272",
      line: "#ddd8cc",
      accent: "#b4381f",
      "accent-ink": "#fffdf8",
    },
    font: { display: "Fraunces", text: "Karla" },
    size: ["0.8rem", "0.95rem", "1.05rem", "1.4rem", "2rem", "3.2rem", "clamp(3rem, 10vw, 7rem)"],
    space: ["4px", "8px", "16px", "28px", "48px", "88px", "140px"],
    radius: ["0px", "2px", "0px"],
    motion: { duration: "220ms", easing: "ease-out" },
  },
  typography: {
    display: {
      family: "Fraunces",
      url: "https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&display=swap",
      weights: [400, 700],
    },
    // a url that would silently fail to load
    text: { family: "Karla", url: "nonsense://bad", weights: [400, 600] },
    pairing: "Serif display against a humanist sans.",
  },
  palette: { rationale: "Ink and paper.", unusualChoice: "Vermilion from the ink drawer." },
  layout: {
    grid: "12 columns, 1180px",
    rhythm: "wide",
    sections: [
      { slug: "hero", job: "state it", shape: "full-bleed" },
      { slug: "work", job: "prove it", shape: "asymmetric grid" },
      { slug: "process", job: "explain it", shape: "stepped list" },
      { slug: "contact", job: "convert", shape: "quiet, contained" },
    ],
  },
  imagery: { strategy: "typographic", treatment: "none", queries: [] },
  motion: "subtle",
  voice: { tone: "dry", sample: { h1: "Set in lead.", sub: "Since 1998.", cta: "Get a quote" } },
  avoid: ["No stock photo of hands on paper", "No cream-and-serif default"],
});

const direction = parseArtDirection(REPLY)!;

/** A page that honours the contract in every respect. */
function compliantPage(d = direction): string {
  return `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="${d.typography.display.url}">
<link rel="stylesheet" href="${d.typography.text.url}">
<style>
${serialiseTokens(d.tokens)}
body { background: var(--color-ground); color: var(--color-ink); font-family: var(--font-text), sans-serif; }
h1 { font-family: var(--font-display), serif; font-size: var(--size-6); }
.btn:focus-visible { outline: 2px solid var(--color-accent); }
</style></head><body>
<header data-part="header"><nav><a href="/">Proof</a></nav></header>
<section data-section="hero"><h1>Set in lead.</h1><p>Since 1998.</p></section>
<section data-section="work"><div><ul><li><a href="/a">A</a></li></ul></div></section>
<section data-section="process"><ol><li>One</li></ol><figure><blockquote>Q</blockquote></figure></section>
<section data-section="contact"><form><label>Email</label><input></form></section>
<footer data-part="footer"><small>Proof</small></footer>
<script>document.querySelectorAll('[data-reveal]');new IntersectionObserver(e=>e.forEach(x=>x.target.classList.add('in-view')));</script>
</body></html>`;
}

function split(html: string) {
  return {
    css: [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n"),
    sections: [
      ...html.matchAll(/<section[^>]*data-section=["']([a-z0-9-]+)["'][\s\S]*?<\/section>/gi),
    ].map((m) => ({ slug: m[1], html: m[0] })),
  };
}

function check(html: string, d = direction) {
  const { css, sections } = split(html);
  return validateMockup(html, css, sections, d);
}

describe("parseArtDirection", () => {
  it("reads a complete direction", () => {
    expect(direction.concept.name).toBe("Proof");
    expect(direction.layout.sections).toHaveLength(4);
    expect(direction.avoid).toHaveLength(2);
  });

  it("normalises shorthand hex to one canonical form", () => {
    expect(direction.tokens.color.ground).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("replaces a font url that is not Google Fonts", () => {
    expect(direction.typography.text.url).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?/);
    expect(direction.typography.text.url).toContain("Karla");
  });

  it("returns null when there is no concept to work with", () => {
    expect(parseArtDirection("not json at all")).toBeNull();
    expect(parseArtDirection('{"concept":{}}')).toBeNull();
  });

  it("maps the old wizard's style names onto the four shapes", () => {
    expect(resolveShape("bold")).toBe("immersive");
    expect(resolveShape("business")).toBe("systematic");
    expect(resolveShape("editorial")).toBe("editorial");
    expect(resolveShape(undefined)).toBe("editorial");
  });
});

describe("contrast", () => {
  it("lifts body text to 4.5:1 against its ground", () => {
    expect(
      contrastRatio(direction.tokens.color.ink, direction.tokens.color.ground)
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(direction.tokens.color["ink-2"], direction.tokens.color.ground)
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("holds muted text to 3:1 rather than collapsing it into the body colour", () => {
    expect(
      contrastRatio(direction.tokens.color.muted, direction.tokens.color.ground)
    ).toBeGreaterThanOrEqual(3);
  });

  it("darkens on a light ground and lightens on a dark one", () => {
    expect(contrastRatio(ensureContrast("#bbbbbb", "#ffffff"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ensureContrast("#333333", "#000000"), "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves a passing pair untouched", () => {
    expect(ensureContrast("#000000", "#ffffff")).toBe("#000000");
  });
});

describe("validateMockup", () => {
  it("passes a compliant page with no complaints at all", () => {
    const result = check(compliantPage());
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  // The two false positives that would have made almost every generation retry.
  it("does not treat a font fallback stack or shorthand hex as drift", () => {
    const html = compliantPage()
      .replace('--font-display: "Fraunces";', "--font-display: 'Fraunces', Georgia, serif;")
      .replace("--color-ground: #ffffff;", "--color-ground: #FFF;");

    expect(check(html).failures).toEqual([]);
  });

  it("does not count JSON-LD against the one-script rule", () => {
    const html = compliantPage().replace(
      "</head>",
      '<script type="application/ld+json">{"@type":"Organization"}</script></head>'
    );

    expect(check(html).ok).toBe(true);
  });

  it("fails a page with too few sections", () => {
    const html = compliantPage().replace(/<section data-section="contact">[\s\S]*?<\/section>/, "");
    const result = check(html);

    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("sections.count");
  });

  it("fails when the font tokens are bypassed", () => {
    const html = compliantPage()
      .replace(/var\(--font-display\)/g, "Fraunces")
      .replace(/var\(--font-text\)/g, "Karla");
    const result = check(html);

    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("font.unused");
  });

  it("fails on placeholder copy", () => {
    const html = compliantPage().replace("Since 1998.", "Lorem ipsum dolor sit amet");
    expect(check(html).failures.map((f) => f.code)).toContain("lorem");
  });

  it("fails when there is no :root block to build on", () => {
    const html = compliantPage().replace(/:root\s*\{[\s\S]*?\}/, "");
    const result = check(html);

    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("tokens.missing");
  });

  it("records drift without demanding a retry, since repair handles it", () => {
    const html = compliantPage().replace("--color-accent: #b4381f;", "--color-accent: #7c3aed;");
    const result = check(html);

    const drift = result.failures.find((f) => f.code === "tokens.drift");
    expect(drift?.fatal).toBe(false);
  });
});

describe("repairMockup", () => {
  it("puts a drifted colour back to what the direction decided", () => {
    const html = compliantPage().replace("--color-accent: #b4381f;", "--color-accent: #7c3aed;");
    const { html: fixed, repairs } = repairMockup(html, direction);

    expect(repairs.join(" ")).toContain("tokens");
    expect(readRootTokens(fixed)["--color-accent"]).toBe("#b4381f");
  });

  it("adds a font link the designer left out", () => {
    const html = compliantPage().replace(
      `<link rel="stylesheet" href="${direction.typography.text.url}">`,
      ""
    );
    const { html: fixed, repairs } = repairMockup(html, direction);

    expect(repairs.join(" ")).toContain("Karla");
    expect(check(fixed).failures).toEqual([]);
  });

  it("keeps custom properties the designer added of its own accord", () => {
    const html = compliantPage()
      .replace("--motion-easing: ease-out;", "--motion-easing: ease-out;\n  --shadow-1: 0 2px 8px rgba(0,0,0,.1);")
      .replace("--color-ink: #1a1712;", "--color-ink: #222222;");

    const { html: fixed } = repairMockup(html, direction);

    expect(readRootTokens(fixed)["--shadow-1"]).toBeDefined();
    expect(readRootTokens(fixed)["--color-ink"]).toBe("#1a1712");
  });

  it("does nothing when there is no direction to enforce", () => {
    const html = compliantPage();
    expect(repairMockup(html, null)).toEqual({ html, repairs: [] });
  });
});

describe("retryNote", () => {
  it("names only the fatal failures", () => {
    const note = retryNote([
      { code: "sections.count", detail: "3 sections", fatal: true },
      { code: "tokens.drift", detail: "accent", fatal: false },
    ]);

    expect(note).toContain("sections.count");
    expect(note).not.toContain("tokens.drift");
  });

  it("is empty when nothing fatal happened", () => {
    expect(retryNote([{ code: "banned.font", detail: "Inter", fatal: false }])).toBe("");
  });
});
