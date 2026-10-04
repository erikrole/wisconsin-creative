import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * AES-256-GCM field encryption with a dedicated key per use. Ciphertext is
 * `v1.<iv>.<tag>.<ciphertext>` in base64url and decryption fails closed for
 * malformed or tampered data.
 */
export function createSecretBox(options: { readKey: () => string; keyName: string; label: string }) {
  const { readKey, keyName, label } = options;
  const invalid = () => new Error(`Invalid ${label} ciphertext`);

  function key(): Buffer {
    const encoded = readKey().trim();
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== KEY_BYTES || encoded.replace(/=+$/, "") !== bytes.toString("base64").replace(/=+$/, "")) {
      throw new Error(`${keyName} must decode to exactly 32 bytes`);
    }
    return bytes;
  }

  return {
    /** The returned value contains no plaintext. */
    encrypt(value: string): string {
      if (!value) throw new Error(`${label[0]!.toUpperCase()}${label.slice(1)} values cannot be empty`);
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key(), iv);
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
    },

    decrypt(payload: string): string {
      const [version, encodedIv, encodedTag, encodedCiphertext] = payload.split(".");
      if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) throw invalid();
      const iv = Buffer.from(encodedIv, "base64url");
      const authTag = Buffer.from(encodedTag, "base64url");
      const ciphertext = Buffer.from(encodedCiphertext, "base64url");
      if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) throw invalid();
      try {
        const decipher = createDecipheriv(ALGORITHM, key(), iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        throw invalid();
      }
    },
  };
}
