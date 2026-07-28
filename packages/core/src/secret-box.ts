import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * Authenticated encryption for secrets at rest.
 *
 * One thing needs it so far: the TOTP shared secret. That secret is a second
 * factor only for as long as nobody else has it, and a database dump is the
 * most likely way somebody else gets it — the same dump that leaks it also
 * carries the hashed session tokens and the phone numbers, so the factor would
 * fall at the same moment as the thing it was protecting.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails rather than
 * decrypting to something. The key comes from the environment, not the
 * database, which is the whole point.
 */

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT = "siumora.secret-box.v1";

/**
 * Derive a key from a passphrase.
 *
 * scrypt with a fixed salt: a per-secret salt would need storing beside the
 * ciphertext and buys nothing here, because there is one key and it is not a
 * password anybody chose — the work factor exists so a weak env var is still
 * expensive to attack.
 */
export function deriveKey(passphrase: string): Buffer {
  if (passphrase.length < 16) {
    throw new RangeError(
      "encryption key must be at least 16 characters — a short one is a plaintext column with extra steps",
    );
  }
  return scryptSync(passphrase, SALT, KEY_LENGTH);
}

/** `v1.iv.tag.ciphertext`, all base64url. Versioned so the scheme can move. */
export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Open a sealed value.
 *
 * Returns undefined rather than throwing on a bad tag or a wrong key: a
 * rotated key should disable a second factor and prompt re-enrolment, not
 * crash every admin request with a stack trace.
 */
export function open(sealed: string, key: Buffer): string | undefined {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return undefined;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(parts[1] as string, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(parts[2] as string, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3] as string, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return undefined;
  }
}

/**
 * Hash a recovery code.
 *
 * SHA-256, not scrypt. These are fifty bits of machine-generated entropy, not
 * a password somebody chose, so there is no dictionary to run and the cost of a
 * slow hash buys nothing — while an operator locked out and typing eight codes
 * in a row would feel it.
 */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
