import { describe, expect, it } from "vitest";
import { crc32 as nodeCrc } from "node:zlib";

import { createZip, crc32 } from "../zip";

/**
 * A ZIP nobody can open is worse than no download button. These are the two
 * things that make an archive readable: a correct CRC per entry, and offsets
 * that point where the central directory says they do.
 */
describe("crc32", () => {
  it("matches zlib", () => {
    const enc = new TextEncoder();

    for (const sample of [
      "",
      "a",
      "hello world",
      "Sveiki — ąčęėįšųūž",
      String.fromCharCode(0, 1, 31, 127, 255),
      "x".repeat(100_000),
    ]) {
      expect(crc32(enc.encode(sample))).toBe(nodeCrc(Buffer.from(sample, "utf8")) >>> 0);
    }
  });
});

describe("createZip", () => {
  const at = new Date("2026-08-31T14:56:00Z");

  it("writes a header, a directory entry and an end record per file", () => {
    const zip = createZip([{ name: "a.txt", data: "hello" }], at);
    const view = new DataView(zip.buffer, zip.byteOffset);

    expect(view.getUint32(0, true)).toBe(0x04034b50); // local header
    // 30-byte header + 5-byte name + 5 bytes of data.
    expect(view.getUint32(40, true)).toBe(0x02014b50); // central directory
    expect(zip.at(-22)).toBe(0x50); // end record starts here
  });

  it("records the offsets the central directory promises", () => {
    const zip = createZip(
      [
        { name: "a.txt", data: "one" },
        { name: "b.txt", data: "two" },
      ],
      at
    );

    const view = new DataView(zip.buffer, zip.byteOffset);
    const firstEntry = 2 * (30 + 5 + 3);

    expect(view.getUint32(firstEntry, true)).toBe(0x02014b50);
    expect(view.getUint32(firstEntry + 42, true)).toBe(0); // first file at 0
    expect(view.getUint32(firstEntry + 46 + 5 + 42, true)).toBe(38); // second after the first
  });

  it("is exactly the end record when there is nothing to pack", () => {
    const zip = createZip([]);

    expect(zip).toHaveLength(22);
    expect(new DataView(zip.buffer, zip.byteOffset).getUint32(0, true)).toBe(0x06054b50);
  });

  it("normalises paths without throwing", () => {
    expect(createZip([{ name: "/leading.txt", data: "x" }]).length).toBeGreaterThan(0);
    expect(createZip([{ name: "a\\b.txt", data: "x" }]).length).toBeGreaterThan(0);
  });
});
