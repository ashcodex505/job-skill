import fs from "node:fs/promises";
import path from "node:path";
import type { StorageDriver } from "./index";

const ROOT = process.env.RESUME_STORAGE_PATH ?? path.join(process.cwd(), "data");

function resolveSafe(key: string): string {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(path.resolve(ROOT) + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return full;
}

export function localStorageDriver(): StorageDriver {
  return {
    name: "local",
    async put(key, data) {
      const full = resolveSafe(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
    },
    async get(key) {
      return fs.readFile(resolveSafe(key));
    },
    async delete(key) {
      await fs.rm(resolveSafe(key), { force: true });
    },
  };
}
