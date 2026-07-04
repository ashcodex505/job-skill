import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateKey, KEY_BYTES } from "./encryption";

const execFileAsync = promisify(execFile);

/**
 * macOS Keychain integration via the built-in `security` CLI.
 *
 * The app generates one random 256-bit key and stores it as a generic
 * password in the user's login keychain. The key never appears in the
 * database, in env files, or in logs. `execFile` (not a shell) is used so the
 * key hex is never subject to shell interpolation; note it is still visible
 * in the process args of the one-off `add-generic-password` call, which is
 * acceptable for a single-user local machine (documented in docs/security.md).
 */

const SERVICE = process.env.KEYCHAIN_SERVICE ?? "resume-tracker";
const ACCOUNT = "encryption-key";

export function keychainAvailable(): boolean {
  return process.platform === "darwin";
}

export async function readKeychainKey(): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      SERVICE,
      "-a",
      ACCOUNT,
      "-w",
    ]);
    const hex = stdout.trim();
    const key = Buffer.from(hex, "hex");
    if (key.length !== KEY_BYTES) return null;
    return key;
  } catch {
    return null; // Not found (or keychain locked/denied).
  }
}

export async function storeKeychainKey(key: Buffer): Promise<void> {
  await execFileAsync("security", [
    "add-generic-password",
    "-s",
    SERVICE,
    "-a",
    ACCOUNT,
    "-w",
    key.toString("hex"),
    "-U", // update if it already exists
    "-j",
    "Resume Tracker credential encryption key",
  ]);
}

/** Returns the existing key or creates + persists a new one. */
export async function getOrCreateKeychainKey(): Promise<Buffer> {
  const existing = await readKeychainKey();
  if (existing) return existing;
  const key = generateKey();
  await storeKeychainKey(key);
  // Read back to confirm the write landed before we encrypt anything with it.
  const verify = await readKeychainKey();
  if (!verify) throw new Error("Failed to persist encryption key to the macOS Keychain");
  return verify;
}
