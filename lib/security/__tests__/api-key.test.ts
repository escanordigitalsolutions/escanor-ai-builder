import { describe, it, expect } from "vitest";

import {
  generateApiKey,
  hashKeySecret,
  maskKeyId,
  parseApiKey,
  verifyKeySecret,
} from "@/lib/security/api-key";

describe("generateApiKey", () => {
  it("produces a well-formed key and matching hash", () => {
    const key = generateApiKey();

    expect(key.plaintext).toMatch(
      /^esk_(live|test)_[a-f0-9]{16}_[a-f0-9]{64}$/
    );
    expect(key.keyId).toMatch(/^[a-f0-9]{16}$/);
    expect(key.keyHash).toMatch(/^[a-f0-9]{64}$/);

    const parsed = parseApiKey(key.plaintext);
    expect(parsed).not.toBeNull();
    expect(parsed?.keyId).toBe(key.keyId);
    expect(hashKeySecret(parsed!.secret)).toBe(key.keyHash);
  });

  it("generates unique keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();

    expect(a.keyId).not.toBe(b.keyId);
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});

describe("parseApiKey", () => {
  it("rejects malformed keys", () => {
    expect(parseApiKey("")).toBeNull();
    expect(parseApiKey("nope")).toBeNull();
    expect(parseApiKey("esk_live_short_secret")).toBeNull();
    expect(parseApiKey(`wrong_live_${"a".repeat(16)}_${"b".repeat(64)}`)).toBeNull();
    expect(parseApiKey(`esk_live_${"z".repeat(16)}_${"0".repeat(64)}`)).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    const key = generateApiKey();
    expect(parseApiKey(`  ${key.plaintext}  `)?.keyId).toBe(key.keyId);
  });
});

describe("verifyKeySecret", () => {
  it("accepts the correct secret and rejects a wrong one", () => {
    const key = generateApiKey();
    const parsed = parseApiKey(key.plaintext)!;

    expect(verifyKeySecret(parsed.secret, key.keyHash)).toBe(true);
    expect(verifyKeySecret("f".repeat(64), key.keyHash)).toBe(false);
  });

  it("rejects a secret of the wrong shape", () => {
    const key = generateApiKey();
    expect(verifyKeySecret("not-hex", key.keyHash)).toBe(false);
  });
});

describe("hashKeySecret / maskKeyId", () => {
  it("hashes deterministically", () => {
    expect(hashKeySecret("abc")).toBe(hashKeySecret("abc"));
    expect(hashKeySecret("abc")).not.toBe(hashKeySecret("abd"));
  });

  it("masks without leaking the full id", () => {
    const masked = maskKeyId("0123456789abcdef");
    expect(masked).toContain("01234567");
    expect(masked).toContain("...");
    expect(masked).not.toContain("89abcdef");
  });
});
