import { describe, it, expect } from "vitest";

import { normalizeBlueprint, type SitePage } from "@/lib/agent/blueprint";

/**
 * The blueprint's site map.
 *
 * Written after every generated design turned out to be a one-page site: its
 * header linked only to its own sections, and the blueprint then invented a
 * second, unrelated set of pages at build time. The art director now decides
 * the pages once and the design's header links to them, so a blueprint that
 * plans a different set makes those links dead on the finished theme. These
 * assertions are what stops that from coming back.
 */

const sitePages: SitePage[] = [
  { slug: "services", title: "Services", purpose: "" },
  { slug: "work", title: "Our work", purpose: "" },
  { slug: "contact", title: "Contact", purpose: "" },
];

const home = {
  slug: "home",
  title: "Home",
  template: "front-page.php",
  sections: ["hero"],
};

function blueprint(pages: unknown[], menu: unknown[] = []) {
  return {
    frontPage: "home",
    sections: [
      { slug: "hero", type: "hero", layout: "", copy: "" },
      { slug: "grid", type: "grid", layout: "", copy: "" },
    ],
    pages,
    menu,
  } as Record<string, unknown>;
}

const slugs = (bp: Record<string, unknown>) =>
  (bp.pages as { slug: string }[]).map((p) => p.slug);

describe("normalizeBlueprint with an approved design", () => {
  it("makes every page the design named, including ones the planner forgot", () => {
    const bp = blueprint([
      home,
      { slug: "services", title: "Svcs", template: "page-services.php", sections: ["grid"] },
    ]);

    normalizeBlueprint(bp, [], sitePages);

    expect(slugs(bp)).toEqual(["home", "services", "work", "contact"]);
  });

  it("drops a page the planner invented on top of the design", () => {
    const bp = blueprint([
      home,
      { slug: "careers", title: "Careers", template: "page-careers.php", sections: ["grid"] },
    ]);

    normalizeBlueprint(bp, [], sitePages);

    expect(slugs(bp)).not.toContain("careers");
  });

  it("keeps the planner's own work for the pages it did plan", () => {
    const bp = blueprint([
      home,
      {
        slug: "services",
        title: "Svcs",
        template: "page-services.php",
        sections: ["grid"],
        headline: "Three ways in",
      },
    ]);

    normalizeBlueprint(bp, [], sitePages);

    const services = (bp.pages as Record<string, unknown>[]).find(
      (p) => p.slug === "services"
    );

    expect(services?.headline).toBe("Three ways in");
  });

  it("builds the menu from the design, in the design's order", () => {
    const bp = blueprint([home], [{ title: "Whatever", slug: "contact" }]);

    normalizeBlueprint(bp, [], sitePages);

    expect(bp.menu).toEqual([
      { title: "Services", slug: "services" },
      { title: "Our work", slug: "work" },
      { title: "Contact", slug: "contact" },
    ]);
  });

  it("gives every page a template file, stubs included", () => {
    const bp = blueprint([home]);

    normalizeBlueprint(bp, [], sitePages);

    expect(bp.files).toContain("page-work.php");
    expect(bp.files).toContain("page-contact.php");
    // The front page is front-page.php, not page-home.php.
    expect(bp.files).not.toContain("page-home.php");
  });

  it("still hands the front page the mockup's sections", () => {
    const bp = blueprint([
      { ...home, sections: [] },
      { slug: "services", title: "S", template: "page-services.php", sections: [] },
    ]);

    normalizeBlueprint(bp, ["hero", "grid"], sitePages);

    const front = (bp.pages as Record<string, unknown>[]).find(
      (p) => p.slug === "home"
    );

    expect(front?.sections).toEqual(["hero", "grid"]);
  });

  it("stops at eight pages however long the design's list is", () => {
    const bp = blueprint([home]);

    normalizeBlueprint(
      bp,
      [],
      Array.from({ length: 7 }, (_, i) => ({
        slug: `page-${i}`,
        title: `Page ${i}`,
        purpose: "",
      }))
    );

    expect((bp.pages as unknown[]).length).toBe(8);
  });
});

describe("normalizeBlueprint without a design", () => {
  it("leaves the planner's site map alone", () => {
    const bp = blueprint(
      [home, { slug: "about", title: "About", template: "page-about.php", sections: ["grid"] }],
      [
        { title: "About", slug: "about" },
        { title: "Ghost", slug: "ghost" },
      ]
    );

    normalizeBlueprint(bp, []);

    expect(slugs(bp)).toEqual(["home", "about"]);
    // A menu entry pointing at a page that does not exist is still dropped.
    expect(bp.menu).toEqual([{ title: "About", slug: "about" }]);
  });
});
