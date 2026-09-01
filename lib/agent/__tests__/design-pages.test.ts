import { describe, expect, it } from "vitest";

import {
  availablePages,
  isPageSlug,
  pageSlugs,
  pickPage,
  resolvePage,
  titleFromSlug,
} from "@/lib/agent/design-pages";
import { sitePageSpecs } from "@/lib/agent/mockup-core";
import { parseArtDirection } from "@/lib/agent/art-direction";

/**
 * What a design holds, and in what order somebody meets it.
 *
 * Written because the list used to be six names fixed in the source: home,
 * inner, components, archive, notfound, brand. Two of those were documents no
 * visitor could reach and one was a template standing in for every content page
 * at once — so the preview offered six entries of which three were real
 * destinations, while the design's own menu pointed at five pages that had no
 * entry at all. These assertions are what stops a fixed list coming back.
 */

const direction = {
  pages: [
    { slug: "platform", title: "Platform", purpose: "what the product does" },
    { slug: "pricing", title: "Pricing", purpose: "plans and what they cost" },
    { slug: "contact", title: "Contact", purpose: "get in touch" },
  ],
};

const design = {
  html: "<html>home</html>",
  inner_html: "",
  direction,
  pages: {
    platform: "<html>platform</html>",
    pricing: "<html>pricing</html>",
    contact: "<html>contact</html>",
    archive: "<html>blog</html>",
    post: "<html>post</html>",
    notfound: "<html>404</html>",
  },
};

describe("availablePages", () => {
  it("lists the site's pages in the order its own menu lists them", () => {
    expect(availablePages(design).map((p) => p.slug)).toEqual([
      "home",
      "platform",
      "pricing",
      "contact",
      "archive",
      "post",
      "notfound",
    ]);
  });

  it("labels a page the way the site names it, not by its slug", () => {
    const byName = Object.fromEntries(availablePages(design).map((p) => [p.slug, p.label]));

    expect(byName.platform).toBe("Platform");
    expect(byName.home).toBe("Homepage");
    expect(byName.archive).toBe("Blog");
    expect(byName.post).toBe("Blog post");
  });

  it("leaves out a page the direction planned but the run never produced", () => {
    const short = { ...design, pages: { platform: "<html>p</html>" } };

    expect(availablePages(short).map((p) => p.slug)).toEqual(["home", "platform"]);
  });

  it("still shows a stored page the direction never named", () => {
    const stray = { ...design, pages: { ...design.pages, careers: "<html>c</html>" } };
    const entry = availablePages(stray).find((p) => p.slug === "careers");

    expect(entry?.label).toBe("Careers");
  });

  it("keeps an older design readable, with its retired screens last", () => {
    const old = {
      html: "<html>home</html>",
      inner_html: "<html>inner</html>",
      direction: null,
      pages: { components: "<html>c</html>", brand: "<html>b</html>", archive: "<html>a</html>" },
    };

    expect(availablePages(old).map((p) => p.slug)).toEqual([
      "home",
      "archive",
      "inner",
      "components",
      "brand",
    ]);
  });

  it("says nothing about a design that produced nothing", () => {
    expect(availablePages({ html: "", pages: {} })).toEqual([]);
  });
});

describe("pickPage", () => {
  it("finds a page by its slug", () => {
    expect(pickPage(design, "pricing")).toBe("<html>pricing</html>");
    expect(pickPage(design, "home")).toBe("<html>home</html>");
    expect(pickPage(design, "nowhere")).toBe("");
  });

  it("answers a request for the post with an older design's inner page", () => {
    // The inner template is where the post design came from, so a design made
    // before the move still has something honest to show.
    const old = { html: "<html>h</html>", inner_html: "<html>inner</html>", pages: {} };

    expect(pickPage(old, "post")).toBe("<html>inner</html>");
    expect(pickPage(old, "inner")).toBe("<html>inner</html>");
  });
});

describe("slug handling", () => {
  it("accepts what a page slug can be and rejects what it cannot", () => {
    expect(isPageSlug("case-studies")).toBe(true);
    expect(isPageSlug("home")).toBe(true);
    expect(isPageSlug("-leading")).toBe(false);
    expect(isPageSlug("Ąžuolas")).toBe(false);
    expect(isPageSlug("../../etc/passwd")).toBe(false);
    expect(isPageSlug("x".repeat(80))).toBe(false);
  });

  it("never resolves to anything but a slug", () => {
    expect(resolvePage("PRICING")).toBe("pricing");
    expect(resolvePage("../secrets")).toBe("home");
    expect(resolvePage(42)).toBe("home");
  });

  it("reads both the old shape and the new one", () => {
    expect(pageSlugs(["home", "about"])).toEqual(["home", "about"]);
    expect(pageSlugs([{ slug: "home", label: "Homepage" }])).toEqual(["home"]);
    expect(pageSlugs([{ slug: "../x" }, null, 7])).toEqual([]);
    expect(pageSlugs("nope")).toEqual([]);
  });

  it("titles a slug the way a person would write it", () => {
    expect(titleFromSlug("case-studies")).toBe("Case studies");
    expect(titleFromSlug("pricing")).toBe("Pricing");
  });
});

/**
 * Which pages get designed, and what each one is told it is for.
 */
describe("sitePageSpecs", () => {
  const parsed = (pages: unknown) =>
    parseArtDirection(
      JSON.stringify({
        concept: { name: "N", thesis: "t", rootedIn: "r" },
        signatureMove: "s",
        typography: { display: { family: "Syne" }, text: { family: "Karla" }, pairing: "p" },
        palette: { rationale: "r", unusualChoice: "u" },
        layout: { grid: "g", rhythm: "r", sections: [] },
        imagery: { strategy: "typographic", treatment: "", queries: [] },
        motion: "m",
        voice: { tone: "t", sample: { h1: "a", sub: "b", cta: "c" } },
        avoid: [],
        colorways: [],
        pages,
      })
    );

  it("designs every page the art director planned, then the reserved three", () => {
    const specs = sitePageSpecs(parsed(direction.pages));

    expect(specs.map((s) => s.slug)).toEqual([
      "platform",
      "pricing",
      "contact",
      "archive",
      "post",
      "notfound",
    ]);
  });

  it("tells each page what it is for, in the words the direction used", () => {
    const pricing = sitePageSpecs(parsed(direction.pages)).find((s) => s.slug === "pricing");

    expect(pricing?.brief).toContain("/pricing");
    expect(pricing?.brief).toContain("plans and what they cost");
    expect(pricing?.title).toBe("Pricing");
  });

  it("uses the site's own blog page as the blog, rather than adding a second", () => {
    const specs = sitePageSpecs(
      parsed([
        { slug: "about", title: "About", purpose: "" },
        { slug: "journal", title: "Journal", purpose: "writing" },
      ])
    );

    expect(specs.map((s) => s.slug)).toEqual(["about", "journal", "post", "notfound"]);
    // The journal page is briefed as the blog listing, not as a content page.
    expect(specs.find((s) => s.slug === "journal")?.brief).toContain("pagination");
  });

  it("still plans the blog, the post and the 404 with no direction at all", () => {
    expect(sitePageSpecs(null).map((s) => s.slug)).toEqual(["archive", "post", "notfound"]);
  });

  it("gives the 404 less room than a real page, because it is smaller", () => {
    const specs = sitePageSpecs(parsed(direction.pages));
    const notfound = specs.find((s) => s.slug === "notfound")!;
    const platform = specs.find((s) => s.slug === "platform")!;

    expect(notfound.maxTokens).toBeLessThan(platform.maxTokens);
  });
});
