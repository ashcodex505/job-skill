import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Authenticated encryption for local credential storage.
 *
 * - AES-256-GCM with a random 96-bit IV per encryption.
 * - The 128-bit GCM auth tag is appended to the ciphertext, so tampering or
 *   a wrong key fails decryption instead of returning garbage.
 * - Keys are 32 bytes: either random (held in the macOS Keychain) or derived
 *   from a master password with scrypt and a unique per-record salt.
 *
 * This module is pure crypto — it never touches the database, never logs,
 * and never persists anything.
 */

export const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 16;

// scrypt parameters: N=2^15, r=8, p=1 (~32 MiB), interactive-use hardened.
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export interface EncryptedPayload {
  /** hex(ciphertext || authTag) */
  ciphertext: string;
  /** hex IV, 12 bytes */
  iv: string;
}

export class DecryptionError extends Error {
  constructor(message = "Decryption failed: wrong key or corrupted data") {
    super(message);
    this.name = "DecryptionError";
  }
}

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function generateSalt(): string {
  return randomBytes(SALT_BYTES).toString("hex");
}

export function deriveKey(masterPassword: string, saltHex: string): Buffer {
  if (!masterPassword) throw new Error("Master password must not be empty");
  const salt = Buffer.from(saltHex, "hex");
  if (salt.length < 8) throw new Error("Salt too short");
  return scryptSync(masterPassword, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * 1024 * 1024,
  });
}

export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  if (key.length !== KEY_BYTES) throw new Error("Key must be 32 bytes");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString("hex"),
    iv: iv.toString("hex"),
  };
}

export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new Error("Key must be 32 bytes");
  try {
    const data = Buffer.from(payload.ciphertext, "hex");
    if (data.length < TAG_BYTES) throw new Error("Ciphertext too short");
    const ciphertext = data.subarray(0, data.length - TAG_BYTES);
    const tag = data.subarray(data.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "hex"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Deliberately generic: never leak key material or partial plaintext.
    throw new DecryptionError();
  }
}

export function keysEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
