import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const DB_FILE = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "resume-tracker.db");

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const globalForDb = globalThis as unknown as { __rtDb?: ReturnType<typeof buildDb> };

function buildDb() {
  const client = createClient({ url: `file:${DB_FILE}` });
  return drizzle(client, { schema });
}

/** Singleton across Next.js hot reloads. */
export const db = globalForDb.__rtDb ?? (globalForDb.__rtDb = buildDb());

export * as tables from "./schema";
export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();
