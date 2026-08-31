import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../bridge", () => ({
  listProjectFiles: vi.fn(async () => {
    throw new Error("The operation was aborted due to timeout");
  }),
  readProjectFiles: vi.fn(async () => {
    throw new Error("The operation was aborted due to timeout");
  }),
}));

import { listProjectFiles, readProjectFiles } from "../bridge";
import {
  SNAPSHOT_LIMITS,
  createProjectFileReader,
  parseProjectSnapshot,
} from "../project-files";

/**
 * The snapshot path exists because the pull path cannot be relied on: the SaaS
 * can only call back into a site that is publicly reachable within ten seconds,
 * and a large share of real WordPress installs are not. Every bridge call in
 * these tests therefore fails, the way it does on such a site — the assertions
 * are about what still works anyway.
 */

/** A payload shaped exactly like the one WPAB_Files::snapshot() produces. */
const PAYLOAD = {
  scope: "theme",
  files: {
    "style.css": "/*\nTheme Name: Pour Grid\n*/\n",
    "functions.php": "<?php\n// setup\n",
    // Lithuanian and an em dash: the bytes/characters distinction is real here.
    "header.php": "<header>Sveiki — ąčęėįšųūž</header>\n",
    "assets/css/components.css": ".card{display:grid}\n",
  },
  truncated: false,
  skipped: 0,
};

const reader = (snapshot: ReturnType<typeof parseProjectSnapshot>) =>
  createProjectFileReader({ snapshot, siteUrl: "https://example.test", token: "t" });

beforeEach(() => {
  vi.mocked(listProjectFiles).mockClear();
  vi.mocked(readProjectFiles).mockClear();
});

describe("parseProjectSnapshot", () => {
  it("accepts the plugin's payload intact", () => {
    const snapshot = parseProjectSnapshot(PAYLOAD);

    expect(snapshot).not.toBeNull();
    expect([...snapshot!.files.keys()].sort()).toEqual([
      "assets/css/components.css",
      "functions.php",
      "header.php",
      "style.css",
    ]);
    expect(snapshot!.files.get("header.php")).toBe("<header>Sveiki — ąčęėįšųūž</header>\n");
  });

  it("rejects anything that is not a theme snapshot", () => {
    expect(parseProjectSnapshot(null)).toBeNull();
    expect(parseProjectSnapshot("theme")).toBeNull();
    expect(parseProjectSnapshot({ scope: "plugin", files: { "a.php": "x" } })).toBeNull();
    expect(parseProjectSnapshot({ scope: "theme", files: [] })).toBeNull();
    expect(parseProjectSnapshot({ scope: "theme", files: {} })).toBeNull();
  });

  it("drops paths that try to leave the theme", () => {
    for (const path of [
      "../evil.php",
      "/etc/passwd",
      "a/../../b.php",
      ".env",
      "a\\b.php",
      "x/./y.php",
      "a//b.php",
      "a\0b.php",
    ]) {
      const snapshot = parseProjectSnapshot({
        scope: "theme",
        files: { [path]: "x", "ok.php": "y" },
      });

      expect(snapshot!.files.has(path)).toBe(false);
      // Anything dropped means the snapshot is no longer the whole truth.
      expect(snapshot!.truncated).toBe(true);
    }
  });

  it("enforces the file, size and total budgets", () => {
    const oversized = parseProjectSnapshot({
      scope: "theme",
      files: { "big.css": "a".repeat(SNAPSHOT_LIMITS.maxFileBytes + 1), "ok.php": "y" },
    });
    expect(oversized!.files.size).toBe(1);

    const many = Object.fromEntries(
      Array.from({ length: SNAPSHOT_LIMITS.maxFiles + 50 }, (_, i) => [`f${i}.php`, "x"])
    );
    expect(parseProjectSnapshot({ scope: "theme", files: many })!.files.size).toBe(
      SNAPSHOT_LIMITS.maxFiles
    );

    const heavy = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`f${i}.css`, "a".repeat(150_000)])
    );
    const capped = parseProjectSnapshot({ scope: "theme", files: heavy })!;
    expect(capped.files.size).toBeLessThan(30);
    expect(capped.truncated).toBe(true);
  });

  it("ignores non-string content", () => {
    const snapshot = parseProjectSnapshot({
      scope: "theme",
      files: { "ok.php": "y", "n.php": 123 },
    });

    expect(snapshot!.files.has("n.php")).toBe(false);
  });
});

describe("createProjectFileReader", () => {
  it("lists without touching the site", async () => {
    const listing = (await reader(parseProjectSnapshot(PAYLOAD)).list("theme")) as {
      count: number;
      files: { path: string; bytes: number }[];
    };

    expect(listProjectFiles).not.toHaveBeenCalled();
    expect(listing.count).toBe(4);
    expect(listing.files[0].path).toBe("assets/css/components.css");
    // UTF-8 bytes, not JavaScript string length.
    expect(listing.files.find((f) => f.path === "header.php")!.bytes).toBe(
      Buffer.byteLength(PAYLOAD.files["header.php"], "utf8")
    );
  });

  it("reads without touching the site", async () => {
    const out = (await reader(parseProjectSnapshot(PAYLOAD)).read("theme", [
      "functions.php",
      "style.css",
    ])) as { files: { path: string; success: boolean; sha256: string }[] };

    expect(readProjectFiles).not.toHaveBeenCalled();
    expect(out.files.map((f) => f.path).sort()).toEqual(["functions.php", "style.css"]);
    expect(out.files.every((f) => f.success && f.sha256.length === 64)).toBe(true);
  });

  it("treats a complete snapshot as the whole truth", async () => {
    const out = (await reader(parseProjectSnapshot(PAYLOAD)).read("theme", ["nope.php"])) as {
      files: { success: boolean; error: string }[];
    };

    // Calling the site to confirm a file does not exist would reintroduce the
    // dependency this module removes — and cost ten seconds to learn nothing.
    expect(readProjectFiles).not.toHaveBeenCalled();
    expect(out.files[0].success).toBe(false);
    expect(out.files[0].error).toMatch(/not part of this theme/);
  });

  it("asks the site only for what a truncated snapshot is missing, and survives failure", async () => {
    const snapshot = parseProjectSnapshot({ ...PAYLOAD, truncated: true });

    const out = (await reader(snapshot).read("theme", ["functions.php", "big.css"])) as {
      files: { path: string; success: boolean }[];
    };

    expect(readProjectFiles).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readProjectFiles).mock.calls[0][3]).toEqual(["big.css"]);

    // The failed pull must not take the file we already had down with it.
    expect(out.files.find((f) => f.path === "functions.php")!.success).toBe(true);
    expect(out.files.find((f) => f.path === "big.css")!.success).toBe(false);
  });

  it("falls back to the bridge when no snapshot was sent", async () => {
    await expect(reader(null).list("theme")).rejects.toThrow(/timeout/);
    expect(listProjectFiles).toHaveBeenCalledTimes(1);
  });

  it("truncates a long file the way the bridge does", async () => {
    const snapshot = parseProjectSnapshot({
      scope: "theme",
      files: { "a.css": "b".repeat(SNAPSHOT_LIMITS.maxReadChars + 500) },
    });

    const out = (await reader(snapshot).read("theme", ["a.css"])) as {
      files: { content: string; truncated: boolean }[];
    };

    expect(out.files[0].content).toHaveLength(SNAPSHOT_LIMITS.maxReadChars);
    expect(out.files[0].truncated).toBe(true);
  });
});
