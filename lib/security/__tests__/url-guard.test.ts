import { describe, it, expect } from "vitest";

import {
  assertSafeBridgeOrigin,
  isPrivateAddress,
} from "@/lib/security/url-guard";

describe("isPrivateAddress", () => {
  it("flags loopback, private and link-local IPv4", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("100.64.0.1")).toBe(true); // CGNAT
  });

  it("flags the cloud metadata address", () => {
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
  });

  it("flags loopback and unique-local IPv6", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true); // mapped loopback
  });

  it("allows real public addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("treats non-IP strings as unsafe", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("assertSafeBridgeOrigin", () => {
  it("rejects non-HTTPS URLs", async () => {
    await expect(
      assertSafeBridgeOrigin("http://example.com")
    ).rejects.toMatchObject({ reason: "insecure_protocol" });
  });

  it("rejects embedded credentials", async () => {
    await expect(
      assertSafeBridgeOrigin("https://user:pass@example.com")
    ).rejects.toMatchObject({ reason: "embedded_credentials" });
  });

  it("rejects blocked hostnames and suffixes", async () => {
    await expect(
      assertSafeBridgeOrigin("https://localhost")
    ).rejects.toMatchObject({ reason: "blocked_hostname" });

    await expect(
      assertSafeBridgeOrigin("https://my-site.local")
    ).rejects.toMatchObject({ reason: "blocked_hostname" });

    await expect(
      assertSafeBridgeOrigin("https://staging.internal")
    ).rejects.toMatchObject({ reason: "blocked_hostname" });
  });

  it("rejects private IP literals without a DNS lookup", async () => {
    await expect(
      assertSafeBridgeOrigin("https://127.0.0.1")
    ).rejects.toMatchObject({ reason: "private_address" });

    await expect(
      assertSafeBridgeOrigin("https://169.254.169.254")
    ).rejects.toMatchObject({ reason: "private_address" });

    await expect(
      assertSafeBridgeOrigin("https://10.0.0.1")
    ).rejects.toMatchObject({ reason: "private_address" });
  });

  it("rejects malformed URLs", async () => {
    await expect(
      assertSafeBridgeOrigin("not a url")
    ).rejects.toMatchObject({ reason: "invalid_url" });
  });

  it("accepts a public IP literal", async () => {
    const result = await assertSafeBridgeOrigin("https://8.8.8.8");

    expect(result.origin).toBe("https://8.8.8.8");
    expect(result.addresses).toContain("8.8.8.8");
  });
});
