import { describe, expect, it } from "vitest";

import { resolveTarget, screenForHref } from "../design-links";
import { DESIGN_PAGES } from "../design-pages";

/**
 * The preview is walked, not looked at, so every link in a generated design has
 * to lead somewhere. The one idea underneath: the inner page is the template
 * every content page uses, so an ordinary internal link is not a guess — it is
 * what the visitor would actually get.
 */
describe("screenForHref", () => {
  it("leaves the page's own business alone", () => {
    expect(screenForHref("#method")).toBeNull();
    expect(screenForHref("")).toBeNull();
    expect(screenForHref("mailto:hi@example.test")).toBeNull();
    expect(screenForHref("tel:+37060000000")).toBeNull();
    expect(screenForHref("javascript:void(0)")).toBeNull();
  });

  it("lets a real outbound link stay outbound", () => {
    expect(screenForHref("https://wordpress.org/plugins")).toBeNull();
    // Same host is the site talking to itself.
    expect(screenForHref("https://site.test/about", "site.test")).toBe("inner");
  });

  it("finds the homepage", () => {
    for (const href of ["/", "/home", "/index.html", "index.html"]) {
      expect(screenForHref(href)).toBe("home");
    }
  });

  it("recognises the screens a theme designs separately", () => {
    expect(screenForHref("/journal")).toBe("archive");
    expect(screenForHref("/news/2026/spring")).toBe("archive");
    expect(screenForHref("/insights")).toBe("archive");
    expect(screenForHref("/404")).toBe("notfound");
    expect(screenForHref("/brand")).toBe("brand");
    expect(screenForHref("/style-guide")).toBe("components");
  });

  it("sends every other internal link to the inner page", () => {
    for (const href of ["/about", "/services", "/contact", "/pricing", "/team/ana"]) {
      expect(screenForHref(href)).toBe("inner");
    }
  });

  it("ignores query strings and fragments", () => {
    expect(screenForHref("/journal?page=2#top")).toBe("archive");
  });
});

describe("resolveTarget", () => {
  const all = [...DESIGN_PAGES];

  it("uses the screen when the run produced it", () => {
    expect(resolveTarget("/journal", all)).toBe("archive");
  });

  it("falls back to the inner page when it did not", () => {
    // A short run makes fewer screens; doing nothing on a click reads as broken.
    expect(resolveTarget("/journal", ["home", "inner"])).toBe("inner");
  });

  it("falls back to the homepage when there is no inner page either", () => {
    expect(resolveTarget("/journal", ["home"])).toBe("home");
    expect(resolveTarget("/about", ["home"])).toBe("home");
  });

  it("keeps a homepage link on the homepage", () => {
    expect(resolveTarget("/", ["home", "inner"])).toBe("home");
  });

  it("still declines the links that were never navigation", () => {
    expect(resolveTarget("#top", all)).toBeNull();
    expect(resolveTarget("https://example.test", all)).toBeNull();
  });
});
