import { describe, it, expect, beforeAll } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

beforeAll(() => {
  // 32-byte key, base64 — the format getEncryptionKey() expects.
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value", () => {
    const secret = "esk_live_deadbeefdeadbeef_" + "a".repeat(64);
    const encrypted = encryptSecret(secret);

    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("uses a versioned four-part envelope", () => {
    const encrypted = encryptSecret("hello");
    const parts = encrypted.split(".");

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects an unsupported envelope format", () => {
    expect(() => decryptSecret("garbage")).toThrow();
    expect(() => decryptSecret("v2.a.b.c")).toThrow();
  });

  it("rejects tampered ciphertext (auth tag mismatch)", () => {
    const encrypted = encryptSecret("tamper-me");
    const parts = encrypted.split(".");

    // Flip the first character of the ciphertext segment.
    const segment = parts[3];
    parts[3] = (segment[0] === "A" ? "B" : "A") + segment.slice(1);

    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
