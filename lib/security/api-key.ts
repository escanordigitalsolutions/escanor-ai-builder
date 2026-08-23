import crypto from "crypto";

/**
 * Site-scoped API keys.
 *
 * Format: esk_<env>_<keyId>_<secret>
 *
 *   esk      fixed prefix, makes leaked keys greppable in logs and repos
 *   env      "live" or "test", so a staging key cannot be pasted into prod
 *   keyId    16 hex chars, stored in the clear and used for row lookup
 *   secret   64 hex chars, only ever stored as SHA-256
 *
 * Everything is hex so the underscore separator can never appear inside a
 * segment (base64url would collide with it).
 */

const KEY_PREFIX = "esk";

const KEY_ID_BYTES = 8;
const KEY_SECRET_BYTES = 32;

const KEY_ID_PATTERN = /^[a-f0-9]{16}$/;
const KEY_SECRET_PATTERN = /^[a-f0-9]{64}$/;

export type GeneratedApiKey = {
  keyId: string;
  keyHash: string;
  plaintext: string;
};

export type ParsedApiKey = {
  keyId: string;
  secret: string;
};

function environmentTag() {
  return process.env.VERCEL_ENV === "production" ? "live" : "test";
}

export function hashKeySecret(secret: string) {
  return crypto
    .createHash("sha256")
    .update(secret)
    .digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const keyId = crypto
    .randomBytes(KEY_ID_BYTES)
    .toString("hex");

  const secret = crypto
    .randomBytes(KEY_SECRET_BYTES)
    .toString("hex");

  return {
    keyId,
    keyHash: hashKeySecret(secret),
    plaintext: [
      KEY_PREFIX,
      environmentTag(),
      keyId,
      secret,
    ].join("_"),
  };
}

export function parseApiKey(value: string): ParsedApiKey | null {
  const parts = value.trim().split("_");

  if (parts.length !== 4) {
    return null;
  }

  const [prefix, , keyId, secret] = parts;

  if (prefix !== KEY_PREFIX) {
    return null;
  }

  if (!KEY_ID_PATTERN.test(keyId) || !KEY_SECRET_PATTERN.test(secret)) {
    return null;
  }

  return {
    keyId,
    secret,
  };
}

export function verifyKeySecret(secret: string, expectedHash: string) {
  if (!KEY_SECRET_PATTERN.test(secret)) {
    return false;
  }

  const actual = Buffer.from(hashKeySecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Safe-to-display fragment, e.g. "esk_live_a1b2c3d4...".
 * Never reconstructs the secret.
 */
export function maskKeyId(keyId: string) {
  return `${KEY_PREFIX}_${environmentTag()}_${keyId.slice(0, 8)}...`;
}
