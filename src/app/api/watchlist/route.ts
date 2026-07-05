import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { badRequest, handler, ok } from "@/lib/api";
import { parseWatchlist, serializeWatchlist, watchEquals, type Watch } from "@/lib/career/watchlist";
import { COMPANY_PORTALS } from "@/scraper/registry";

const execFileAsync = promisify(execFile);

const CAREER_DIR = process.env.CAREER_DIR ?? path.join(process.cwd(), "career");
const FILE = path.join(CAREER_DIR, "watchlist.md");

function readWatches(): Watch[] {
  try {
    return parseWatchlist(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

/** Atomic replace: write a temp file in the same dir, then rename over. */
function writeWatches(watches: Watch[]): void {
  fs.mkdirSync(CAREER_DIR, { recursive: true });
  const tmp = path.join(CAREER_DIR, `.watchlist.${process.pid}.tmp`);
  fs.writeFileSync(tmp, serializeWatchlist(watches));
  fs.renameSync(tmp, FILE);
}

/** Uncommitted local changes mean hourly CI alerts run on a stale watchlist. */
async function isDirty(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--", FILE], {
      cwd: process.cwd(),
      timeout: 5000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function state() {
  return ok({
    watches: readWatches(),
    companies: [...COMPANY_PORTALS.map((p) => p.name)].sort(),
    dirty: await isDirty(),
  });
}

export const GET = handler(async () => state());

const watchInput = z.object({
  company: z.string().trim().min(1).max(120),
  keywords: z.string().trim().min(2).max(200),
});

export const POST = handler(async (req: Request) => {
  const watch = watchInput.parse(await req.json());
  const watches = readWatches();
  if (watches.some((w) => watchEquals(w, watch))) return badRequest("That watch already exists");
  writeWatches([...watches, watch]);
  return state();
});

export const DELETE = handler(async (req: Request) => {
  const watch = watchInput.parse(await req.json());
  const watches = readWatches();
  const remaining = watches.filter((w) => !watchEquals(w, watch));
  if (remaining.length === watches.length) return badRequest("Watch not found");
  writeWatches(remaining);
  return state();
});
