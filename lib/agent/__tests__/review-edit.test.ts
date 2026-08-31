import { describe, expect, it } from "vitest";

import { parseReview } from "../review-edit";

/**
 * The review runs on the cheap tier and its output is shown to the site owner
 * beside an Undo button. Everything here is about one property: a model that
 * ignores the format, or has a verdict but nothing to say, must not be able to
 * alarm anybody. Silence is the safe answer.
 */
describe("parseReview", () => {
  it("says nothing when the edit is fine", () => {
    expect(parseReview("VERDICT: ok")).toEqual({ ok: true, note: "" });
    expect(parseReview("VERDICT: OK\n")).toEqual({ ok: true, note: "" });
  });

  it("carries a real finding through", () => {
    expect(parseReview("VERDICT: problem\nNOTE: The old class name is still used in header.php.")).toEqual({
      ok: false,
      note: "The old class name is still used in header.php.",
    });
    expect(parseReview("verdict: problem\nnote: lowercase works")).toEqual({
      ok: false,
      note: "lowercase works",
    });
    expect(parseReview("Some preamble.\nVERDICT: problem\nNOTE: real note\nmore")).toEqual({
      ok: false,
      note: "real note",
    });
  });

  it("stays silent on anything nobody could act on", () => {
    // A verdict with no note is not a problem anyone can do something about.
    expect(parseReview("VERDICT: problem")).toEqual({ ok: true, note: "" });
    expect(parseReview("VERDICT: problem\nNOTE:   ")).toEqual({ ok: true, note: "" });
    expect(parseReview("Looks fine to me!")).toEqual({ ok: true, note: "" });
    expect(parseReview("")).toEqual({ ok: true, note: "" });
    expect(parseReview("VERDICT: maybe\nNOTE: hmm")).toEqual({ ok: true, note: "" });
  });

  it("bounds the note", () => {
    expect(parseReview(`VERDICT: problem\nNOTE: ${"x".repeat(500)}`).note).toHaveLength(300);
  });
});
