import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error("APP_ENCRYPTION_KEY is missing.");
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be a 32-byte base64 encoded key."
    );
  }

  return key;
}

export function encryptSecret(value: string) {
  const key = getEncryptionKey();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    ALGORITHM,
    key,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decryptSecret(value: string) {
  const parts = value.split(".");

  if (
    parts.length !== 4 ||
    parts[0] !== "v1"
  ) {
    throw new Error(
      "Unsupported encrypted secret format."
    );
  }

  const [, ivBase64, tagBase64, encryptedBase64] =
    parts;

  const key = getEncryptionKey();

  const iv = Buffer.from(
    ivBase64,
    "base64"
  );

  const authTag = Buffer.from(
    tagBase64,
    "base64"
  );

  const encrypted = Buffer.from(
    encryptedBase64,
    "base64"
  );

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    iv
  );

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
