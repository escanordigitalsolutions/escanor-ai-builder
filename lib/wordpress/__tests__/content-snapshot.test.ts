import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../bridge", () => ({
  listSiteContentTypes: vi.fn(async () => {
    throw new Error("The operation was aborted due to timeout");
  }),
  listSiteContent: vi.fn(async () => {
    throw new Error("The operation was aborted due to timeout");
  }),
  getSiteContentItem: vi.fn(async () => {
    throw new Error("The operation was aborted due to timeout");
  }),
}));

import {
  getSiteContentItem,
  listSiteContent,
  listSiteContentTypes,
} from "../bridge";
import {
  CONTENT_SNAPSHOT_LIMITS,
  createContentReader,
  parseContentSnapshot,
} from "../content-snapshot";

/**
 * As in project-files.test.ts, every call back into the site fails here — that
 * is the situation this module exists for. The assertions are about what the
 * chat can still answer.
 */

/** Shaped like WPAB_Content::snapshot() on a small site. */
const PAYLOAD = {
  types: {
    success: true,
    woocommerce: false,
    types: [
      { key: "page", label: "Pages", kind: "post_type", count: 3 },
      { key: "post", label: "Posts", kind: "post_type", count: 2 },
      { key: "secret", label: "Secret", kind: "post_type", count: 0 },
    ],
  },
  listings: {
    page: [
      { id: 1, title: "Home", status: "publish", type: "page" },
      { id: 2, title: "About", status: "publish", type: "page" },
      { id: 4, title: "Huge", status: "publish", type: "page" },
    ],
    post: [{ id: 10, title: "Post 10", status: "publish", type: "post" }],
  },
  bodies: {
    "page:1": { success: true, item: { id: 1, title: "Home", content: "Sveiki" } },
    // The plugin sends pages before posts and skips bodies over its per-item
    // cap, so "Huge" (page 4) is listed but has no body here.
    "page:2": {
      success: true,
      item: { id: 2, title: "About", content: "Mes esame maža studija — nuo 2019." },
    },
  },
  truncated: true,
};

const reader = (snapshot: ReturnType<typeof parseContentSnapshot>) =>
  createContentReader({ snapshot, siteUrl: "https://example.test", token: "t" });

beforeEach(() => {
  vi.mocked(listSiteContentTypes).mockClear();
  vi.mocked(listSiteContent).mockClear();
  vi.mocked(getSiteContentItem).mockClear();
});

describe("parseContentSnapshot", () => {
  it("accepts the plugin's payload", () => {
    const snapshot = parseContentSnapshot(PAYLOAD)!;

    expect(snapshot.listings.get("page")).toHaveLength(3);
    expect(snapshot.bodies.size).toBe(2);
    expect(snapshot.truncated).toBe(true);
  });

  it("rejects what it cannot use", () => {
    expect(parseContentSnapshot(null)).toBeNull();
    expect(parseContentSnapshot({})).toBeNull();
    expect(parseContentSnapshot("content")).toBeNull();
    expect(parseContentSnapshot({ listings: { "a b": [1] } })).toBeNull();
  });

  it("drops unsafe type keys and malformed body keys", () => {
    const listings = parseContentSnapshot({
      listings: { page: [{ id: 1 }], "../x": [{ id: 2 }], ok_type: [{ id: 3 }] },
    })!;

    expect([...listings.listings.keys()].sort()).toEqual(["ok_type", "page"]);
    expect(listings.truncated).toBe(true);

    const bodies = parseContentSnapshot({
      bodies: {
        "page:1": { a: 1 },
        "page:x": { a: 1 },
        "../p:1": { a: 1 },
        "page:2": "not an object",
      },
    })!;

    expect([...bodies.bodies.keys()]).toEqual(["page:1"]);
  });

  it("caps the listing count and rejects an oversized snapshot whole", () => {
    const wide = parseContentSnapshot({
      listings: Object.fromEntries(
        Array.from({ length: CONTENT_SNAPSHOT_LIMITS.maxListings + 5 }, (_, i) => [
          `t${i}`,
          [{ id: i }],
        ])
      ),
    })!;

    expect(wide.listings.size).toBe(CONTENT_SNAPSHOT_LIMITS.maxListings);

    expect(
      parseContentSnapshot({
        bodies: {
          "page:1": { content: "a".repeat(CONTENT_SNAPSHOT_LIMITS.maxTotalBytes + 10) },
        },
      })
    ).toBeNull();
  });
});

describe("createContentReader", () => {
  it("answers types and listings without touching the site", async () => {
    const snapshot = parseContentSnapshot(PAYLOAD);

    const types = (await reader(snapshot).types()) as { types: { key: string }[] };
    expect(types.types.map((t) => t.key)).toEqual(["page", "post", "secret"]);

    const pages = (await reader(snapshot).list("page")) as { items: { title: string }[] };
    expect(pages.items[0].title).toBe("Home");

    expect(listSiteContentTypes).not.toHaveBeenCalled();
    expect(listSiteContent).not.toHaveBeenCalled();
  });

  it("knows an empty type is empty rather than asking", async () => {
    const out = (await reader(parseContentSnapshot(PAYLOAD)).list("secret")) as {
      items: unknown[];
    };

    expect(out.items).toEqual([]);
    expect(listSiteContent).not.toHaveBeenCalled();
  });

  it("serves a body it was given", async () => {
    const out = (await reader(parseContentSnapshot(PAYLOAD)).item("page", 2)) as {
      item: { title: string; content: string };
    };

    expect(getSiteContentItem).not.toHaveBeenCalled();
    expect(out.item.title).toBe("About");
    expect(out.item.content).toMatch(/maža studija/);
  });

  it("tries the site once for a body the plugin could not fit, then degrades", async () => {
    const out = (await reader(parseContentSnapshot(PAYLOAD)).item("page", 4)) as {
      success: boolean;
      error: string;
    };

    expect(getSiteContentItem).toHaveBeenCalledTimes(1);
    expect(out.success).toBe(false);
    // The model has to know it is answering without the text, not invent it.
    expect(out.error).toMatch(/cannot be reached/);
  });

  it("never calls the site when the snapshot is complete", async () => {
    const complete = parseContentSnapshot({ ...PAYLOAD, truncated: false });

    const out = (await reader(complete).item("page", 999)) as { success: boolean };

    expect(getSiteContentItem).not.toHaveBeenCalled();
    expect(out.success).toBe(false);
  });

  it("falls back to the bridge when nothing was sent", async () => {
    await expect(reader(null).types()).rejects.toThrow(/timeout/);
    expect(listSiteContentTypes).toHaveBeenCalledTimes(1);
  });
});
