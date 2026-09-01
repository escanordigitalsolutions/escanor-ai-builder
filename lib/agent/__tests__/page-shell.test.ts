import { describe, expect, it } from "vitest";

import {
  detectContainer,
  pageRetryNote,
  sectionClasses,
  validateSitePage,
  type PageRules,
} from "@/lib/agent/page-shell";

/**
 * Every case below is taken from one real generation, and every verdict here
 * agrees with what a browser measured on those same files.
 *
 * That generation produced nine pages that each read as finished — 400 to 700
 * words, real sections, correct tokens — and four of them put their content on
 * a different left edge from the homepage. Services put it against the window.
 * Nothing in the pipeline noticed, because the homepage is validated hard and
 * the pages after it were not validated at all.
 */

/** The homepage's shape, reduced to what these checks look at. */
const HOME = `<!DOCTYPE html><html><head><style>
  section { padding: var(--space-5) max(24px, calc((100vw - 1296px)/2)); }
  .section-inner { max-width: 1296px; margin: auto; }
  .card { padding: 1rem; }
</style></head><body>
  <section data-section="one"><div class="section-inner"><h2>One</h2></div></section>
  <section data-section="two"><div class="section-inner"><h2>Two</h2></div></section>
</body></html>`;

const HOME_CSS = [...HOME.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
  .map((m) => m[1])
  .join("\n");

const words = (n: number) => "word ".repeat(n).trim();

const body = (inner: string) => `<main data-part="page-body">${inner}</main>`;

const twoGoodSections = body(
  `<section class="a"><div class="section-inner"><p>${words(200)}</p></div></section>` +
    `<section class="b"><div class="section-inner"><p>${words(200)}</p></div></section>`
);

const RULES: PageRules = { container: "section-inner", minWords: 260 };

const codes = (page: { slug: string; body: string; css: string }, rules = RULES) =>
  validateSitePage(page, rules).filter((f) => f.fatal).map((f) => f.code);

describe("detectContainer", () => {
  it("finds the wrapper the homepage actually uses", () => {
    expect(detectContainer(HOME, HOME_CSS)).toBe("section-inner");
  });

  it("ignores a max-width class that is not a section wrapper", () => {
    // `.card` has padding but no max-width, and is not a section's first child.
    expect(detectContainer(HOME, HOME_CSS)).not.toBe("card");
  });

  it("wants a convention, not a one-off", () => {
    const once = `<body><section><div class="only-here"><h2>x</h2></div></section></body>`;
    expect(detectContainer(once, ".only-here{max-width:80rem}")).toBeNull();
  });

  it("says nothing rather than guessing when there is no wrapper at all", () => {
    expect(detectContainer("<body><section><h2>x</h2></section></body>", "")).toBeNull();
  });
});

describe("sectionClasses", () => {
  it("collects only what sits on a section", () => {
    const html = `<section class="hero wide"><div class="section-inner"><p class="lead">x</p></div></section>`;

    expect([...sectionClasses(html)].sort()).toEqual(["hero", "wide"]);
  });
});

describe("validateSitePage", () => {
  it("passes a page that keeps the site's shape", () => {
    expect(codes({ slug: "about", body: twoGoodSections, css: ".a{padding-block:4rem}" })).toEqual([]);
  });

  /**
   * The exact failure from the real run: a page setting its own vertical
   * rhythm with a two-value shorthand, which silently replaces the site's
   * horizontal gutter with zero.
   */
  it("catches the shorthand that deletes the gutter", () => {
    expect(
      codes({ slug: "services", body: twoGoodSections, css: ".a{padding: var(--space-5) 0}" })
    ).toContain("page.gutter");
  });

  it("allows a one-value padding, which cannot move the sides", () => {
    expect(codes({ slug: "about", body: twoGoodSections, css: ".a{padding: 4rem}" })).toEqual([]);
  });

  it("is not fooled by the spaces inside calc() and max()", () => {
    // One top-level value. This is the homepage's own idiom, and rejecting it
    // would fail every correct page.
    expect(
      codes({ slug: "about", body: twoGoodSections, css: ".a{padding: max(24px, calc((100vw - 80rem)/2))}" })
    ).toEqual([]);
  });

  it("catches the other ways a section can move its own edge", () => {
    for (const rule of [
      ".a{padding-left:4rem}",
      ".a{padding-inline:4rem}",
      ".a{margin-inline:2rem}",
      ".a{max-width:60rem}",
      "section{padding:2rem 1rem}",
    ]) {
      expect(codes({ slug: "x", body: twoGoodSections, css: rule })).toContain("page.gutter");
    }
  });

  it("leaves rules alone that style something inside a section", () => {
    // `.a .lead` styles the paragraph, not the section. Flagging it because
    // `.a` sits on a section would reject correct pages.
    expect(
      codes({ slug: "about", body: twoGoodSections, css: ".a .lead{padding:0 2rem;max-width:40ch}" })
    ).toEqual([]);
  });

  it("catches a page that invents its own wrapper", () => {
    const own = body(`<section class="a"><div class="pricing-wrap"><p>${words(400)}</p></div></section>`);

    expect(codes({ slug: "pricing", body: own, css: "" })).toContain("page.container");
  });

  it("catches a page that is headings with empty boxes under them", () => {
    const thin = body(`<section class="a"><div class="section-inner"><h2>Our standard</h2></div></section>`);

    expect(codes({ slug: "about", body: thin, css: "" })).toContain("page.thin");
  });

  it("holds a 404 to a floor it can actually meet", () => {
    const short = body(
      `<section class="a"><div class="section-inner"><p>${words(50)}</p></div></section>` +
        `<section class="b"><div class="section-inner"><p>${words(10)}</p></div></section>`
    );

    expect(codes({ slug: "notfound", body: short, css: "" })).toContain("page.thin");
    expect(codes({ slug: "notfound", body: short, css: "" }, { ...RULES, minWords: 35 })).toEqual([]);
  });

  it("reports a page with no body at all, and stops there", () => {
    const result = validateSitePage({ slug: "about", body: "", css: ".a{padding:1rem 2rem}" }, RULES);

    expect(result.map((f) => f.code)).toEqual(["page.body"]);
  });

  it("counts one section as a soft fault, not a reason to redraw", () => {
    const one = body(`<section class="a"><div class="section-inner"><p>${words(400)}</p></div></section>`);
    const result = validateSitePage({ slug: "blog", body: one, css: "" }, RULES);

    expect(result.find((f) => f.code === "page.sections")?.fatal).toBe(false);
  });

  it("checks nothing about the wrapper when the homepage has no convention", () => {
    expect(
      codes({ slug: "about", body: twoGoodSections, css: "" }, { container: null, minWords: 260 })
    ).toEqual([]);
  });
});

describe("pageRetryNote", () => {
  it("says only what went wrong, and how the edges work", () => {
    const note = pageRetryNote(
      [
        { code: "page.gutter", detail: "'.a' sets a horizontal padding.", fatal: true },
        { code: "page.sections", detail: "Only one section.", fatal: false },
      ],
      "section-inner"
    );

    expect(note).toContain("sets a horizontal padding");
    expect(note).toContain("section-inner");
    expect(note).toContain("padding-block");
    // Soft faults are not worth spending a retry's attention on.
    expect(note).not.toContain("Only one section");
  });

  it("is empty when nothing fatal happened, so no retry is triggered", () => {
    expect(pageRetryNote([{ code: "page.sections", detail: "x", fatal: false }], "wrap")).toBe("");
  });
});
