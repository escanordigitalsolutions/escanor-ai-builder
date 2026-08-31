import { describe, expect, it } from "vitest";

import {
  applyAnchoredEdits,
  mergeEditedFiles,
  parseEditOutput,
} from "../edit-output";

const CSS = `:root {
  --ink: #141312;
}
.btn {
  background: var(--ink);
  padding: 10px 18px;
}
.card {
  background: var(--ink);
}
`;

const read = (path: string) => (path === "style.css" ? CSS : undefined);

describe("parseEditOutput", () => {
  it("reads whole-file blocks", () => {
    const out = parseEditOutput(
      "SUMMARY: replaced the header\n===WPAB_FILE:header.php===\n<header>hi</header>\n===WPAB_END==="
    );

    expect(out.summary).toBe("replaced the header");
    expect(out.files).toEqual([{ path: "header.php", contents: "<header>hi</header>\n" }]);
  });

  it("strips a markdown fence a cheap model wrapped the file in", () => {
    const out = parseEditOutput(
      "===WPAB_FILE:a.css===\n```css\n.a{color:red}\n```\n===WPAB_END==="
    );

    expect(out.files[0].contents).toBe(".a{color:red}\n");
  });

  it("does not let a missing end marker merge two files", () => {
    const out = parseEditOutput(
      "===WPAB_FILE:a.css===\n.a{}\n===WPAB_FILE:b.css===\n.b{}\n===WPAB_END==="
    );

    expect(out.files.map((f) => f.path)).toEqual(["a.css", "b.css"]);
    expect(out.files[0].contents).toBe(".a{}\n");
  });

  it("reads anchored edits", () => {
    const out = parseEditOutput(
      "SUMMARY: green buttons\n" +
        "===WPAB_EDIT:style.css===\n---FIND---\n  background: var(--ink);\n  padding: 10px 18px;\n---REPLACE---\n  background: green;\n  padding: 10px 18px;\n===WPAB_END==="
    );

    expect(out.anchors).toHaveLength(1);
    expect(out.anchors[0].path).toBe("style.css");
    expect(out.anchors[0].find).toContain("padding: 10px 18px;");
    expect(out.anchors[0].replace).toContain("background: green;");
  });

  it("ignores an anchor with nothing to find", () => {
    const out = parseEditOutput(
      "===WPAB_EDIT:style.css===\n---FIND---\n   \n---REPLACE---\nx\n===WPAB_END==="
    );

    expect(out.anchors).toHaveLength(0);
  });

  it("reads both shapes from one reply", () => {
    const out = parseEditOutput(
      "===WPAB_EDIT:style.css===\n---FIND---\n.card {\n---REPLACE---\n.card, .tile {\n===WPAB_END===\n" +
        "===WPAB_FILE:footer.php===\n<footer></footer>\n===WPAB_END==="
    );

    expect(out.anchors).toHaveLength(1);
    expect(out.files).toHaveLength(1);
  });

  it("falls back to a default summary", () => {
    expect(parseEditOutput("===WPAB_FILE:a.css===\n.a{}\n").summary).toBe("Updated the theme.");
  });
});

describe("applyAnchoredEdits", () => {
  it("changes only the anchored text and leaves the rest byte for byte", () => {
    const { files, errors } = applyAnchoredEdits(
      [{ path: "style.css", find: "  --ink: #141312;", replace: "  --ink: #0a0a0a;" }],
      read
    );

    expect(errors).toEqual([]);
    expect(files[0].contents).toBe(CSS.replace("  --ink: #141312;", "  --ink: #0a0a0a;"));
  });

  it("applies several anchors to one file in order", () => {
    const { files, errors } = applyAnchoredEdits(
      [
        { path: "style.css", find: ".btn {", replace: ".btn, .button {" },
        { path: "style.css", find: ".card {", replace: ".card, .tile {" },
      ],
      read
    );

    expect(errors).toEqual([]);
    expect(files).toHaveLength(1);
    expect(files[0].contents).toContain(".btn, .button {");
    expect(files[0].contents).toContain(".card, .tile {");
  });

  it("lets a later anchor match what an earlier one wrote", () => {
    const { files, errors } = applyAnchoredEdits(
      [
        { path: "style.css", find: ".btn {", replace: ".primary {" },
        { path: "style.css", find: ".primary {", replace: ".primary-button {" },
      ],
      read
    );

    expect(errors).toEqual([]);
    expect(files[0].contents).toContain(".primary-button {");
  });

  it("refuses an anchor that matches twice rather than guessing", () => {
    // "background: var(--ink);" appears in both .btn and .card. Picking one
    // would be a coin flip on which part of the page changes.
    const { files, errors } = applyAnchoredEdits(
      [{ path: "style.css", find: "  background: var(--ink);", replace: "  background: red;" }],
      read
    );

    expect(files).toEqual([]);
    expect(errors[0]).toMatch(/appears more than once/);
  });

  it("reports an anchor it cannot find", () => {
    const { files, errors } = applyAnchoredEdits(
      [{ path: "style.css", find: ".nope {", replace: ".yes {" }],
      read
    );

    expect(files).toEqual([]);
    expect(errors[0]).toMatch(/was not found/);
  });

  it("reports a file the site did not send", () => {
    const { files, errors } = applyAnchoredEdits(
      [{ path: "ghost.css", find: "a", replace: "b" }],
      read
    );

    expect(files).toEqual([]);
    expect(errors[0]).toMatch(/not part of this theme/);
  });

  it("keeps the anchors that worked when one fails", () => {
    const { files, errors } = applyAnchoredEdits(
      [
        { path: "style.css", find: ".btn {", replace: ".button {" },
        { path: "style.css", find: ".missing {", replace: ".x {" },
      ],
      read
    );

    expect(files).toHaveLength(1);
    expect(files[0].contents).toContain(".button {");
    expect(errors).toHaveLength(1);
  });

  it("can delete text by replacing it with nothing", () => {
    const { files } = applyAnchoredEdits(
      [{ path: "style.css", find: "\n.card {\n  background: var(--ink);\n}\n", replace: "" }],
      read
    );

    expect(files[0].contents).not.toContain(".card");
    expect(files[0].contents).toContain(".btn");
  });
});

describe("mergeEditedFiles", () => {
  it("lets a whole-file rewrite win over an anchor on the same path", () => {
    const merged = mergeEditedFiles(
      [{ path: "a.css", contents: "whole\n" }],
      [
        { path: "a.css", contents: "anchored\n" },
        { path: "b.css", contents: "other\n" },
      ]
    );

    expect(merged.find((f) => f.path === "a.css")!.contents).toBe("whole\n");
    expect(merged).toHaveLength(2);
  });
});
