import dns from "dns/promises";
import net from "net";

/**
 * SSRF guard for outbound WordPress Bridge calls.
 *
 * This replaces the old `WP_BRIDGE_ALLOWED_HOSTS` hard allowlist, which could
 * never scale past a single hand-configured site. The allowlist is now
 * optional: set it to pin staging to known hosts, leave it empty in production
 * so real customers can connect any public site.
 *
 * With the allowlist gone, the resolved address is what protects us. Every
 * hostname is resolved before the fetch and *every* returned record must be a
 * public unicast address, so a customer cannot point their "site URL" at
 * 127.0.0.1, a metadata endpoint, or an internal VPC host.
 *
 * Residual risk: DNS rebinding between this check and the fetch. Closing that
 * fully requires pinning the connection to the validated IP with a custom
 * dispatcher. Given the bridge also requires a valid bearer token, refuses
 * redirects, and only ever calls /wp-json/wp-ai-builder/v1/*, the remaining
 * exposure is a blind request with no readable response.
 */

export type UnsafeOriginReason =
  | "invalid_url"
  | "insecure_protocol"
  | "embedded_credentials"
  | "blocked_hostname"
  | "private_address"
  | "dns_failure"
  | "not_allowlisted";

export class UnsafeOriginError extends Error {
  reason: UnsafeOriginReason;
  status: number;

  constructor(message: string, reason: UnsafeOriginReason, status = 400) {
    super(message);
    this.name = "UnsafeOriginError";
    this.reason = reason;
    this.status = status;
  }
}

export type SafeOrigin = {
  origin: string;
  hostname: string;
  addresses: string[];
};

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
]);

const BLOCKED_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".home.arpa",
  ".test",
  ".example",
  ".invalid",
  ".onion",
];

/**
 * Note: a few documentation ranges are blocked at /16 rather than their exact
 * /24. Nothing is legitimately hosted there, so the over-match is deliberate.
 */
function isPrivateIPv4(address: string) {
  const parts = address.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  const [a, b] = parts;

  if (a === 0) return true;                        // 0.0.0.0/8
  if (a === 10) return true;                       // private
  if (a === 127) return true;                      // loopback
  if (a === 169 && b === 254) return true;         // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true;         // private
  if (a === 192 && b === 0) return true;           // IETF protocol + TEST-NET-1
  if (a === 192 && b === 88) return true;          // 6to4 relay anycast
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true;          // TEST-NET-2
  if (a === 203 && b === 0) return true;           // TEST-NET-3
  if (a >= 224) return true;                       // multicast, reserved, broadcast

  return false;
}

function isPrivateIPv6(address: string) {
  const value = address.toLowerCase().split("%")[0];

  if (value === "::" || value === "::1") {
    return true;
  }

  const mapped =
    value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/) ??
    value.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);

  if (mapped) {
    return isPrivateIPv4(mapped[1]);
  }

  if (value.startsWith("2001:db8")) return true;  // documentation
  if (value.startsWith("64:ff9b")) return true;   // NAT64

  const head = Number.parseInt(value.split(":")[0] || "0", 16);

  if (Number.isNaN(head)) {
    return true;
  }

  if ((head & 0xfe00) === 0xfc00) return true;    // fc00::/7 unique local
  if ((head & 0xffc0) === 0xfe80) return true;    // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true;    // ff00::/8 multicast

  return false;
}

export function isPrivateAddress(address: string) {
  const family = net.isIP(address);

  if (family === 4) {
    return isPrivateIPv4(address);
  }

  if (family === 6) {
    return isPrivateIPv6(address);
  }

  return true;
}

function optionalAllowlist() {
  return new Set(
    (process.env.WP_BRIDGE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function assertSafeBridgeOrigin(
  siteUrl: string
): Promise<SafeOrigin> {
  let url: URL;

  try {
    url = new URL(siteUrl);
  } catch {
    throw new UnsafeOriginError(
      "Invalid WordPress URL.",
      "invalid_url"
    );
  }

  if (url.protocol !== "https:") {
    throw new UnsafeOriginError(
      "WordPress site must use HTTPS.",
      "insecure_protocol"
    );
  }

  if (url.username || url.password) {
    throw new UnsafeOriginError(
      "URLs containing credentials are not allowed.",
      "embedded_credentials"
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  if (!hostname) {
    throw new UnsafeOriginError(
      "Invalid WordPress URL.",
      "invalid_url"
    );
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new UnsafeOriginError(
      "This WordPress hostname is not reachable from the builder.",
      "blocked_hostname",
      403
    );
  }

  const allowlist = optionalAllowlist();

  if (allowlist.size > 0 && !allowlist.has(hostname)) {
    throw new UnsafeOriginError(
      "This WordPress hostname is not allowed.",
      "not_allowlisted",
      403
    );
  }

  const literalFamily = net.isIP(hostname);

  let addresses: string[];

  if (literalFamily) {
    addresses = [hostname];
  } else {
    try {
      const records = await dns.lookup(hostname, {
        all: true,
        verbatim: true,
      });

      addresses = records.map((record) => record.address);
    } catch {
      throw new UnsafeOriginError(
        "Could not resolve the WordPress hostname.",
        "dns_failure",
        502
      );
    }
  }

  if (addresses.length === 0) {
    throw new UnsafeOriginError(
      "Could not resolve the WordPress hostname.",
      "dns_failure",
      502
    );
  }

  // Every record must be public. One private answer poisons the hostname.
  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new UnsafeOriginError(
      "This WordPress hostname resolves to a private network address.",
      "private_address",
      403
    );
  }

  return {
    origin: url.origin,
    hostname,
    addresses,
  };
}
