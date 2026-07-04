import { describe, expect, it } from "vitest";
import {
  DecryptionError,
  decrypt,
  deriveKey,
  encrypt,
  generateKey,
  generateSalt,
} from "./encryption";

describe("encryption", () => {
  it("round-trips plaintext with a random key", () => {
    const key = generateKey();
    const payload = encrypt("hunter2-super-secret", key);
    expect(decrypt(payload, key)).toBe("hunter2-super-secret");
  });

  it("round-trips unicode and long inputs", () => {
    const key = generateKey();
    const text = "pässwörd-🔐-".repeat(500);
    expect(decrypt(encrypt(text, key), key)).toBe(text);
  });

  it("fails with the wrong key", () => {
    const payload = encrypt("secret", generateKey());
    expect(() => decrypt(payload, generateKey())).toThrow(DecryptionError);
  });

  it("fails with a wrong master password (scrypt-derived keys)", () => {
    const salt = generateSalt();
    const right = deriveKey("correct horse battery staple", salt);
    const wrong = deriveKey("correct horse battery stapl3", salt);
    const payload = encrypt("secret", right);
    expect(decrypt(payload, right)).toBe("secret");
    expect(() => decrypt(payload, wrong)).toThrow(DecryptionError);
  });

  it("derives different keys for different salts", () => {
    const a = deriveKey("same-password", generateSalt());
    const b = deriveKey("same-password", generateSalt());
    expect(a.equals(b)).toBe(false);
  });

  it("ciphertext does not contain the plaintext", () => {
    const key = generateKey();
    const plaintext = "very-identifiable-password-string";
    const payload = encrypt(plaintext, key);
    expect(payload.ciphertext).not.toContain(plaintext);
    expect(payload.ciphertext).not.toContain(Buffer.from(plaintext, "utf8").toString("hex"));
  });

  it("uses a unique IV per encryption", () => {
    const key = generateKey();
    const ivs = new Set(Array.from({ length: 50 }, () => encrypt("same input", key).iv));
    expect(ivs.size).toBe(50);
  });

  it("detects tampered ciphertext (GCM auth)", () => {
    const key = generateKey();
    const payload = encrypt("secret", key);
    const bytes = Buffer.from(payload.ciphertext, "hex");
    bytes[0] ^= 0xff;
    expect(() => decrypt({ ...payload, ciphertext: bytes.toString("hex") }, key)).toThrow(DecryptionError);
  });

  it("rejects keys of the wrong length", () => {
    expect(() => encrypt("x", Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});
