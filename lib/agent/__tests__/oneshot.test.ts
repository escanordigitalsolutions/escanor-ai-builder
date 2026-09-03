import { describe, expect, it } from "vitest";

import { parseOneshot } from "@/lib/agent/oneshot-core";

/**
 * The one-shot reply is three documents in one stream, and every failure mode
 * here is a truncation or a model improvising the markers. The parser's one
 * hard rule: a block counts only when it closed — the last file of a cut-off
 * reply is half a page, and half a page in the archive reads as a broken
 * product, not as an experiment.
 */

const doc = (title: string) => `<!DOCTYPE html><html><head></head><body>${title}</body></html>`;

const block = (name: string, html: string) =>
  `===WPAB_FILE:${name}===\n${html}\n===WPAB_END===\n`;

describe("parseOneshot", () => {
  it("reads three files and maps index to home", () => {
    const pages = parseOneshot(
      block("index.html", doc("home")) +
        block("services.html", doc("services")) +
        block("contact.html", doc("contact"))
    );

    expect(pages.map((p) => p.slug)).toEqual(["home", "services", "contact"]);
    expect(pages[0].html).toContain("home");
  });

  it("drops the file a truncated reply cut in half", () => {
    const cut =
      block("index.html", doc("home")) +
      block("menu.html", doc("menu")) +
      `===WPAB_FILE:contact.html===\n<!DOCTYPE html><html><body>ends mid-`;

    expect(parseOneshot(cut).map((p) => p.slug)).toEqual(["home", "menu"]);
  });

  it("ignores chatter around and between the blocks", () => {
    const chatty =
      "Here are your three pages:\n\n" +
      block("index.html", doc("h")) +
      "And the inner page:\n" +
      block("about.html", doc("a")) +
      "Done!";

    expect(parseOneshot(chatty).map((p) => p.slug)).toEqual(["home", "about"]);
  });

  it("takes the first of a duplicated slug and skips a non-document", () => {
    const messy =
      block("index.html", doc("first")) +
      block("index.html", doc("second")) +
      block("styles.css", "body { color: red }");

    const pages = parseOneshot(messy);

    expect(pages).toHaveLength(1);
    expect(pages[0].html).toContain("first");
  });

  it("refuses a slug that could not be a path", () => {
    expect(parseOneshot(block("..%2f..", doc("x")))).toEqual([]);
  });

  it("returns nothing for a reply with no markers at all", () => {
    expect(parseOneshot(doc("just one page, no markers"))).toEqual([]);
  });
});
