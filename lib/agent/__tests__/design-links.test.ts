import { describe, expect, it } from "vitest";

import { resolveTarget, screenForHref } from "../design-links";

/**
 * The preview is walked, not looked at, so every link in a generated design has
 * to lead somewhere.
 *
 * The idea underneath used to be that one inner page was the template every
 * content page shared, so an ordinary internal link could be answered with it.
 * That is what made a design feel like a site of identical rooms: five menu
 * items, one screen, the title swapped. Every page is really designed now, so a
 * link is matched against the pages the design holds and answered with the page
 * itself. Guessing is left for the two screens a visitor reaches by accident
 * rather than by name.
 */

/** A site as the art director would plan one, plus the reserved screens. */
const SITE = ["home", "about", "services", "case-studies", "contact", "archive", "post", "notfound"];

describe("resolveTarget", () => {
  it("leaves the page's own business alone", () => {
    for (const href of ["#method", "", "mailto:hi@example.test", "tel:+37060000000", "javascript:void(0)"]) {
      expect(resolveTarget(href, SITE)).toBeNull();
    }
  });

  it("lets a real outbound link stay outbound", () => {
    expect(resolveTarget("https://wordpress.org/plugins", SITE)).toBeNull();
    // The same host is the site talking to itself.
    expect(resolveTarget("https://site.test/about", SITE, "site.test")).toBe("about");
  });

  it("finds the homepage", () => {
    for (const href of ["/", "/home", "/index.html", "index.html", "https://site.test/"]) {
      expect(resolveTarget(href, SITE, "site.test")).toBe("home");
    }
  });

  it("goes to the page itself — the whole point of designing them", () => {
    expect(resolveTarget("/about", SITE)).toBe("about");
    expect(resolveTarget("/services/", SITE)).toBe("services");
    expect(resolveTarget("/case-studies", SITE)).toBe("case-studies");
    expect(resolveTarget("/contact?ref=footer#form", SITE)).toBe("contact");
  });

  it("takes a post's own url to the post", () => {
    expect(resolveTarget("/journal/why-onboarding-fails", SITE)).toBe("post");
    expect(resolveTarget("/archive/a-post", SITE)).toBe("post");
  });

  it("recognises the blog and the 404 by the shape of the path", () => {
    expect(resolveTarget("/journal", SITE)).toBe("archive");
    expect(resolveTarget("/news", SITE)).toBe("archive");
    expect(resolveTarget("/404", SITE)).toBe("notfound");
    expect(resolveTarget("/not-found", SITE)).toBe("notfound");
  });

  it("answers a link to a page this design lacks with the 404", () => {
    // What a visitor would actually meet. Showing the homepage instead would
    // pretend the link worked.
    expect(resolveTarget("/careers", SITE)).toBe("notfound");
  });

  it("falls back to the homepage when there is no 404 either", () => {
    expect(resolveTarget("/careers", ["home", "about"])).toBe("home");
    expect(resolveTarget("/journal", ["home", "about"])).toBe("home");
  });

  it("prefers the design's own page over the blog-shaped guess", () => {
    // A business whose blog IS /journal has a page at that slug, and the page
    // wins over the pattern that would have sent it to a generic archive.
    expect(resolveTarget("/journal", ["home", "journal", "post"])).toBe("journal");
  });

  it("survives a design that produced almost nothing", () => {
    expect(resolveTarget("/about", ["home"])).toBe("home");
    expect(resolveTarget("/about", [])).toBeNull();
  });

  it("does not treat a path that is not a slug as a page", () => {
    expect(resolveTarget("/Ąžuolas ir kiti", SITE)).toBe("home");
  });
});

describe("screenForHref", () => {
  it("reads the shape of a path without knowing the design", () => {
    expect(screenForHref("/about")).toBe("about");
    expect(screenForHref("/journal")).toBe("archive");
    expect(screenForHref("/404")).toBe("notfound");
    expect(screenForHref("/")).toBe("home");
    expect(screenForHref("#top")).toBeNull();
  });

  it("never returns a reserved screen as if it were a business page", () => {
    // "post" and "notfound" are ours, not slugs a site would use for a page.
    expect(screenForHref("/post")).toBe("home");
  });
});
