import { eq } from "drizzle-orm";
import { db, now, tables } from "@/db";
import {
  DecryptionError,
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  type EncryptedPayload,
} from "./encryption";
import { getOrCreateKeychainKey, keychainAvailable } from "./keychain";

/**
 * Credential key management + encrypt/decrypt service.
 *
 * Two modes, selected automatically:
 *  - "keychain" (default on macOS): a random 256-bit key lives in the macOS
 *    Keychain. Records use encryptionVersion=1 and an empty salt.
 *  - "master" (ENCRYPTION_MODE=master, or non-macOS): the key is derived from
 *    a master password with scrypt + a unique per-record salt
 *    (encryptionVersion=2). The password is held only in process memory after
 *    an explicit unlock (or from RESUME_TRACKER_MASTER_PASSWORD).
 *
 * A verifier record in app_settings lets us detect a wrong master password /
 * swapped keychain key up front, with a clear error and no data corruption.
 */

export const ENC_VERSION_KEYCHAIN = 1;
export const ENC_VERSION_MASTER = 2;

const VERIFIER_KEY = "encryption_check";
const VERIFIER_PLAINTEXT = "resume-tracker-verifier-v1";

export class VaultLockedError extends Error {
  constructor(message = "Credential vault is locked — unlock with your master password in Settings") {
    super(message);
    this.name = "VaultLockedError";
  }
}

type Mode = "keychain" | "master";

interface VaultState {
  mode: Mode;
  keychainKey?: Buffer;
  masterPassword?: string;
}

// Survives Next.js hot reloads; never serialized.
const g = globalThis as unknown as { __rtVault?: VaultState };

function resolveMode(): Mode {
  if (process.env.ENCRYPTION_MODE === "master") return "master";
  if (process.env.ENCRYPTION_MODE === "keychain") return "keychain";
  return keychainAvailable() ? "keychain" : "master";
}

function state(): VaultState {
  if (!g.__rtVault || g.__rtVault.mode !== resolveMode()) {
    g.__rtVault = { mode: resolveMode() };
    const envPassword = process.env.RESUME_TRACKER_MASTER_PASSWORD;
    if (g.__rtVault.mode === "master" && envPassword) g.__rtVault.masterPassword = envPassword;
  }
  return g.__rtVault;
}

export function vaultMode(): Mode {
  return state().mode;
}

export async function isUnlocked(): Promise<boolean> {
  const s = state();
  if (s.mode === "master") return s.masterPassword !== undefined;
  try {
    await keyForEncryption();
    return true;
  } catch {
    return false;
  }
}

async function keyForEncryption(): Promise<{ key: Buffer; salt: string; version: number }> {
  const s = state();
  if (s.mode === "keychain") {
    if (!s.keychainKey) s.keychainKey = await getOrCreateKeychainKey();
    return { key: s.keychainKey, salt: "", version: ENC_VERSION_KEYCHAIN };
  }
  if (!s.masterPassword) throw new VaultLockedError();
  const salt = generateSalt();
  return { key: deriveKey(s.masterPassword, salt), salt, version: ENC_VERSION_MASTER };
}

async function keyForDecryption(salt: string | null, version: number | null): Promise<Buffer> {
  const s = state();
  if (version === ENC_VERSION_KEYCHAIN) {
    if (!s.keychainKey) s.keychainKey = await getOrCreateKeychainKey();
    return s.keychainKey;
  }
  if (version === ENC_VERSION_MASTER) {
    if (!s.masterPassword) throw new VaultLockedError();
    if (!salt) throw new DecryptionError("Record is missing its KDF salt");
    return deriveKey(s.masterPassword, salt);
  }
  throw new DecryptionError(`Unknown encryption version: ${version}`);
}

async function readVerifier(): Promise<(EncryptedPayload & { salt: string; version: number }) | null> {
  const row = await db.query.appSettings.findFirst({ where: eq(tables.appSettings.key, VERIFIER_KEY) });
  if (!row) return null;
  return JSON.parse(row.value);
}

async function writeVerifier(): Promise<void> {
  const { key, salt, version } = await keyForEncryption();
  const payload = { ...encrypt(VERIFIER_PLAINTEXT, key), salt, version };
  await db
    .insert(tables.appSettings)
    .values({ key: VERIFIER_KEY, value: JSON.stringify(payload), updatedAt: now() })
    .onConflictDoUpdate({ target: tables.appSettings.key, set: { value: JSON.stringify(payload), updatedAt: now() } });
}

/** Verifies the active key against the stored verifier; creates it on first use. */
export async function verifyVault(): Promise<void> {
  const verifier = await readVerifier();
  if (!verifier) {
    await writeVerifier();
    return;
  }
  const key = await keyForDecryption(verifier.salt, verifier.version);
  if (decrypt(verifier, key) !== VERIFIER_PLAINTEXT) throw new DecryptionError();
}

/** Master-password mode: verify and cache the password in memory. */
export async function unlockVault(masterPassword: string): Promise<void> {
  const s = state();
  if (s.mode !== "master") throw new Error("Vault uses the macOS Keychain — no master password needed");
  s.masterPassword = masterPassword;
  try {
    await verifyVault();
  } catch (err) {
    s.masterPassword = undefined;
    throw err;
  }
}

export function lockVault(): void {
  const s = state();
  s.masterPassword = undefined;
  s.keychainKey = undefined;
}

export interface StoredSecret {
  ciphertext: string;
  iv: string;
  salt: string;
  version: number;
}

export async function encryptSecret(plaintext: string): Promise<StoredSecret> {
  await verifyVault();
  const { key, salt, version } = await keyForEncryption();
  return { ...encrypt(plaintext, key), salt, version };
}

/**
 * Encrypt several fields under one derived key so a credential row carries a
 * single salt/version (each field still gets its own random IV).
 */
export async function encryptSecrets<K extends string>(
  fields: Record<K, string>,
): Promise<{ salt: string; version: number; values: Record<K, EncryptedPayload> }> {
  await verifyVault();
  const { key, salt, version } = await keyForEncryption();
  const values = {} as Record<K, EncryptedPayload>;
  for (const [name, plaintext] of Object.entries(fields) as [K, string][]) {
    values[name] = encrypt(plaintext, key);
  }
  return { salt, version, values };
}

export async function decryptSecret(secret: StoredSecret): Promise<string> {
  const key = await keyForDecryption(secret.salt, secret.version);
  return decrypt({ ciphertext: secret.ciphertext, iv: secret.iv }, key);
}

export interface CredentialView {
  id: string;
  applicationId: string;
  email: string | null;
  username: string | null;
  hasPassword: boolean;
  hasSecureNotes: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toCredentialView(row: typeof tables.credentials.$inferSelect): CredentialView {
  return {
    id: row.id,
    applicationId: row.applicationId,
    email: row.email,
    username: row.username,
    hasPassword: Boolean(row.encryptedPassword),
    hasSecureNotes: Boolean(row.encryptedNotes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
