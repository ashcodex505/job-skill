import { localStorageDriver } from "./local";
import { supabaseStorageDriver } from "./supabase";

/**
 * Object storage abstraction for resume files.
 *
 * Drivers:
 *  - "local" (default): files under ./data/resumes — zero setup, fully offline.
 *  - "supabase": Supabase Storage free tier — set RESUME_STORAGE_DRIVER=supabase
 *    plus SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_BUCKET.
 *
 * Only resume/cover-letter files ever go through this module. Credentials are
 * encrypted and stay in the local SQLite database — they are never uploaded.
 */
export interface StorageDriver {
  name: "local" | "supabase";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export function getStorage(): StorageDriver {
  return process.env.RESUME_STORAGE_DRIVER === "supabase" ? supabaseStorageDriver() : localStorageDriver();
}

/** Filesystem/object-key safe name: resumes/<uuid>-<sanitized-filename> */
export function makeStorageKey(fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  return `resumes/${crypto.randomUUID()}-${safe}`;
}
