import { describe, expect, it } from "vitest";

import { hitOutputCeiling } from "../toolloop";

/**
 * The bug this guards: a reply cut off at the output ceiling ends mid-file, and
 * the edit routes used to write it. Everything below is about telling "the
 * model finished" apart from "the model ran out of room".
 */
describe("hitOutputCeiling", () => {
  it("is false for a completed response", () => {
    expect(hitOutputCeiling({ status: "completed" })).toBe(false);
  });

  it("is true when the response stopped at max_output_tokens", () => {
    expect(
      hitOutputCeiling({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      })
    ).toBe(true);
  });

  it("is true when incomplete without a stated reason", () => {
    // Fail safe: an incomplete response we cannot explain is not a finished one.
    expect(hitOutputCeiling({ status: "incomplete" })).toBe(true);
    expect(hitOutputCeiling({ status: "incomplete", incomplete_details: null })).toBe(true);
    expect(
      hitOutputCeiling({ status: "incomplete", incomplete_details: { reason: null } })
    ).toBe(true);
  });

  it("is false for an incomplete response stopped for another reason", () => {
    expect(
      hitOutputCeiling({
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
      })
    ).toBe(false);
  });

  it("is false when the provider says nothing at all", () => {
    // A provider that stops sending status must not make every reply look cut.
    expect(hitOutputCeiling({})).toBe(false);
    expect(hitOutputCeiling({ status: null })).toBe(false);
  });
});
