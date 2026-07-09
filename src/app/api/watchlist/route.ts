import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { badRequest, handler, ok } from "@/lib/api";
import { parseWatchlist, serializeWatchlist, watchEquals, type Watch } from "@/lib/career/watchlist";
import { syncWatchWorkflow } from "@/lib/github";
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

/** Uncommitted/unpushed changes mean hourly CI alerts run on a stale watchlist. */
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

/**
 * Auto-sync: commit just the watchlist file and push, so the hourly CI run
 * always sees the latest watches without manual git work. Pathspec-scoped
 * commit leaves any other local changes untouched; a rejected push retries
 * once after rebasing on the CI's board commits. Failures are non-fatal —
 * the dashboard banner remains as the manual fallback. Note: `git push`
 * pushes the whole branch, so any local commits you made ride along.
 */
async function gitSync(): Promise<string | null> {
  const git = (args: string[]) => execFileAsync("git", args, { cwd: process.cwd(), timeout: 60_000 });
  try {
    await git(["add", "--", FILE]);
    try {
      // No [skip ci]: this push is what triggers the immediate watch.yml run.
      await git(["commit", "-m", "chore: update watchlist from dashboard", "--", FILE]);
    } catch {
      return null; // nothing to commit — already in sync
    }
    try {
      await git(["push"]);
    } catch {
      await git(["pull", "--rebase", "--autostash", "origin", "main"]);
      await git(["push"]);
    }
    return null;
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return `Auto-sync to GitHub failed (${detail}) — commit & push career/watchlist.md manually.`;
  }
}

async function state(syncError: string | null = null) {
  return ok({
    watches: readWatches(),
    companies: [...COMPANY_PORTALS.map((p) => p.name)].sort(),
    dirty: await isDirty(),
    syncError,
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
  // Push the file, then re-enable the (possibly self-disabled) CI workflow
  // and dispatch an immediate scan — a disabled workflow ignores the push.
  const errors = [await gitSync(), await syncWatchWorkflow(true)].filter(Boolean);
  return state(errors.length ? errors.join(" ") : null);
});

export const DELETE = handler(async (req: Request) => {
  const watch = watchInput.parse(await req.json());
  const watches = readWatches();
  const remaining = watches.filter((w) => !watchEquals(w, watch));
  if (remaining.length === watches.length) return badRequest("Watch not found");
  writeWatches(remaining);
  // Last watch removed → disable the hourly CI workflow entirely.
  const errors = [await gitSync(), await syncWatchWorkflow(remaining.length > 0)].filter(Boolean);
  return state(errors.length ? errors.join(" ") : null);
});
