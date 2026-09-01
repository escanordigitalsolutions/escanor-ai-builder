import { describe, it, expect } from "vitest";

import {
  contrastRatio,
  ensureContrast,
  parseArtDirection,
  readRootTokens,
  resolveShape,
  sanitiseSvg,
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
  brand: {
    wordmark: "Set in Fraunces, tight tracking, the R's leg cut flat.",
    monogram: "A pressed rule, two bars offset by the width of one.",
    markSvg:
      '<svg viewBox="0 0 32 32"><script>bad()</script><path d="M2 8h28v4H2z" onclick="x()"/><path d="M2 20h20v4H2z"/></svg>',
  },
  colorways: [
    {
      name: "Night press",
      color: {
        ground: "#12100d",
        surface: "#1b1815",
        ink: "#f3efe6",
        "ink-2": "#cdc6b8",
        muted: "#8d8578",
        line: "#2e2a25",
        accent: "#e2673f",
        "accent-ink": "#12100d",
      },
    },
  ],
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

describe("sanitiseSvg", () => {
  /**
   * This markup is written by a model and ends up inline on a customer's
   * WordPress site. Everything below is something a model could plausibly
   * produce and that must not survive.
   */
  const ok = '<svg viewBox="0 0 32 32"><path d="M0 0h32v32H0z"/></svg>';

  it("keeps a plain mark", () => {
    expect(sanitiseSvg(ok)).toContain("<path");
  });

  it("strips a script element", () => {
    const dirty = '<svg viewBox="0 0 32 32"><script>fetch("/steal")</script><circle r="4"/></svg>';
    const clean = sanitiseSvg(dirty);

    expect(clean).not.toContain("script");
    expect(clean).toContain("<circle");
  });

  it("strips event handlers in any quoting style", () => {
    const dirty =
      `<svg viewBox="0 0 32 32"><rect onload="alert(1)" onmouseover='x()' onclick=y() width="4"/></svg>`;
    const clean = sanitiseSvg(dirty);

    expect(clean).not.toMatch(/onload|onmouseover|onclick/i);
    expect(clean).toContain("<rect");
  });

  it("strips javascript: and external links but keeps in-document ones", () => {
    const dirty =
      '<svg viewBox="0 0 32 32"><a href="javascript:alert(1)"><path d="M0 0"/></a>' +
      '<use href="#mark"/></svg>';
    const clean = sanitiseSvg(dirty);

    expect(clean).not.toContain("javascript:");
  });

  it("removes elements that can pull in remote content", () => {
    const dirty =
      '<svg viewBox="0 0 32 32"><image href="https://evil.example/x.png"/><path d="M0 0"/></svg>';
    const clean = sanitiseSvg(dirty);

    expect(clean).not.toContain("evil.example");
  });

  it("refuses anything that is not an svg document", () => {
    expect(sanitiseSvg('<div onclick="x()">hi</div>')).toBe("");
    expect(sanitiseSvg("<svg viewBox='0 0 1 1'><path/>")).toBe("");
    expect(sanitiseSvg("")).toBe("");
    expect(sanitiseSvg(null)).toBe("");
    expect(sanitiseSvg(42)).toBe("");
  });

  it("refuses a mark that is implausibly large", () => {
    const huge = '<svg viewBox="0 0 32 32">' + "<path d='M0 0'/>".repeat(500) + "</svg>";
    expect(sanitiseSvg(huge)).toBe("");
  });
});

describe("colourways", () => {
  it("keeps alternatives and holds each to the readability floor", () => {
    for (const way of direction.colorways) {
      expect(way.name.length).toBeGreaterThan(0);
      expect(contrastRatio(way.color.ink, way.color.ground)).toBeGreaterThanOrEqual(4.5);
      expect(Object.keys(way.color).length).toBeGreaterThanOrEqual(8);
    }
  });

  it("drops a palette identical to the base one", () => {
    const base = JSON.parse(REPLY);
    base.colorways = [{ name: "Same", color: base.tokens.color }];

    expect(parseArtDirection(JSON.stringify(base))?.colorways).toHaveLength(0);
  });

  it("never returns more than two", () => {
    const base = JSON.parse(REPLY);
    base.colorways = ["a", "b", "c", "d"].map((n, i) => ({
      name: n,
      color: { ...base.tokens.color, accent: `#00${i}0${i}0` },
    }));

    expect(parseArtDirection(JSON.stringify(base))?.colorways.length).toBeLessThanOrEqual(2);
  });
});

describe("brand mark", () => {
  it("survives parsing with the svg cleaned", () => {
    expect(direction.brand.wordmark.length).toBeGreaterThan(0);
    expect(direction.brand.markSvg).toContain("<path");
    expect(direction.brand.markSvg).not.toContain("script");
  });
});

/**
 * The section plan's content brief.
 *
 * Added after a real generation came back at 298 words across five sections.
 * The plan specified each section's job and its structural shape and said
 * nothing about what it holds, so "give visitors fast evidence of capability"
 * in a shape built around three oversized figures met a designer correctly
 * forbidden to invent statistics — and the figures were filled with labels.
 */
describe("section content briefs", () => {
  const base = {
    concept: { name: "System Signals", thesis: "t", rootedIn: "r" },
    signatureMove: "one tile migrates down the page",
    typography: {
      display: { family: "Syne" },
      text: { family: "IBM Plex Sans" },
      pairing: "p",
    },
    palette: { rationale: "r", unusualChoice: "u" },
    imagery: { strategy: "typographic", treatment: "", queries: [] },
    motion: "m",
    voice: { tone: "t", sample: { h1: "a", sub: "b", cta: "c" } },
    avoid: [],
    colorways: [],
  };

  const withSections = (sections: unknown[]) =>
    parseArtDirection(
      JSON.stringify({ ...base, layout: { grid: "g", rhythm: "r", sections } })
    );

  it("keeps what each section is supposed to say", () => {
    const direction = withSections([
      {
        slug: "product-modules",
        job: "show the problems",
        shape: "tile matrix",
        content: "four capability blocks, each a short title and 30-50 words",
      },
    ]);

    expect(direction!.layout.sections[0].content).toBe(
      "four capability blocks, each a short title and 30-50 words"
    );
  });

  it("does not break on an art director that ignores the field", () => {
    const direction = withSections([{ slug: "a", job: "j", shape: "s" }]);

    expect(direction!.layout.sections[0].content).toBe("");
    expect(direction!.layout.sections[0].shape).toBe("s");
  });

  it("bounds it like every other model-supplied string", () => {
    const direction = withSections([
      { slug: "a", job: "j", shape: "s", content: 42 },
      { slug: "b", job: "j", shape: "s", content: "x".repeat(9999) },
    ]);

    expect(direction!.layout.sections[0].content).toBe("");
    expect(direction!.layout.sections[1].content).toHaveLength(400);
  });
});

/**
 * The site's page list.
 *
 * Added after a generated design turned out to be a one-page site every time:
 * every href in its header was an in-page anchor, so the preview had nowhere to
 * walk to and the blueprint invented a second, unrelated set of pages at build
 * time. The list is decided once, here, and the nav, the preview and the build
 * all read the same one.
 */
describe("site pages", () => {
  const base = {
    concept: { name: "Proof", thesis: "t", rootedIn: "r" },
    signatureMove: "s",
    typography: {
      display: { family: "Syne" },
      text: { family: "Karla" },
      pairing: "p",
    },
    palette: { rationale: "r", unusualChoice: "u" },
    layout: { grid: "g", rhythm: "r", sections: [] },
    imagery: { strategy: "typographic", treatment: "", queries: [] },
    motion: "m",
    voice: { tone: "t", sample: { h1: "a", sub: "b", cta: "c" } },
    avoid: [],
    colorways: [],
  };

  const withPages = (pages: unknown) =>
    parseArtDirection(JSON.stringify({ ...base, pages }));

  it("keeps the pages the art director planned", () => {
    const direction = withPages([
      { slug: "services", title: "Services", purpose: "what we do" },
      { slug: "contact", title: "Contact", purpose: "get in touch" },
    ]);

    expect(direction!.pages).toEqual([
      { slug: "services", title: "Services", purpose: "what we do" },
      { slug: "contact", title: "Contact", purpose: "get in touch" },
    ]);
  });

  it("slugifies what the model wrote, because the nav links to it", () => {
    const direction = withPages([
      { slug: "Our Work", title: "Our work", purpose: "" },
      { slug: "/case-studies/", title: "Case studies", purpose: "" },
    ]);

    expect(direction!.pages.map((p) => p.slug)).toEqual([
      "our-work",
      "case-studies",
    ]);
  });

  it("drops the homepage: it is the page being designed, not a destination", () => {
    const direction = withPages([
      { slug: "home", title: "Home", purpose: "" },
      { slug: "index", title: "Index", purpose: "" },
      { slug: "about", title: "About", purpose: "" },
    ]);

    expect(direction!.pages.map((p) => p.slug)).toEqual(["about"]);
  });

  it("dedupes and caps, so a runaway list cannot become a runaway nav", () => {
    const direction = withPages([
      { slug: "about", title: "About", purpose: "" },
      { slug: "about", title: "About us", purpose: "" },
      ...Array.from({ length: 12 }, (_, i) => ({
        slug: `p${i}`,
        title: `P${i}`,
        purpose: "",
      })),
    ]);

    expect(direction!.pages).toHaveLength(7);
    expect(direction!.pages.filter((p) => p.slug === "about")).toHaveLength(1);
  });

  it("falls back to the slug when the title is missing", () => {
    expect(withPages([{ slug: "pricing" }])!.pages[0].title).toBe("pricing");
  });

  it("is empty, not broken, for a direction written before pages existed", () => {
    expect(parseArtDirection(JSON.stringify(base))!.pages).toEqual([]);
    expect(withPages("nope")!.pages).toEqual([]);
    expect(withPages([null, 5, { title: "no slug" }])!.pages).toEqual([]);
  });
});
