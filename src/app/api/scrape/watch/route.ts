import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { handler, ok } from "@/lib/api";
import { loadCareerConfig } from "@/lib/career/config";
import { parsePriorityCompanies } from "@/lib/career/priority";
import { parseWatchlist } from "@/lib/career/watchlist";
import { COMPANY_PORTALS } from "@/scraper/registry";
import { runScraper } from "@/scraper/run";

/**
 * Lightweight local watch-scan, triggered by the dashboard watchlist panel
 * while it's open: scrapes watched + priority supported companies, plus the
 * community feeds, into the local DB so the panel's poll can surface
 * brand-new matches without a manual scrape. Server-side throttle keeps
 * repeated panel ticks (every 5 min) from hammering the ATS APIs — effective
 * scan rate ~10 min. career/preferences.md's Summer 2027 approved-companies
 * list doubles as the fast-lane priority list too, alongside
 * career/priority-companies.md — no separate list required for it.
 */
const THROTTLE_MS = 9.5 * 60 * 1000;
const execFileAsync = promisify(execFile);
const g = globalThis as unknown as { __rtLastWatchScan?: number; __rtWatchScanRunning?: boolean };

function readLines(file: string): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), "career", file), "utf8");
  } catch {
    return "";
  }
}

/**
 * You edit career/preferences.md directly (not through a dashboard form),
 * so there's no API-route moment to hook a commit onto the way
 * browser-companies.md/priority-companies.md get one. Instead, every watch
 * tick (while the dashboard is open) checks whether the file has
 * uncommitted changes and pushes them if so — meaning a hand-edit reaches
 * CI within one tick interval (~10 min), not instantly, and not at all
 * while the dashboard is closed.
 */
async function syncPreferencesIfDirty(): Promise<void> {
  const git = (args: string[]) => execFileAsync("git", args, { cwd: process.cwd(), timeout: 60_000 });
  try {
    const { stdout } = await git(["status", "--porcelain", "--", "career/preferences.md"]);
    if (!stdout.trim()) return;
    await git(["add", "--", "career/preferences.md"]);
    await git(["commit", "-m", "chore: update career preferences", "--", "career/preferences.md"]);
    try {
      await git(["push"]);
    } catch {
      await git(["pull", "--rebase", "--autostash", "origin", "main"]);
      await git(["push"]);
    }
  } catch {
    // Best-effort — a sync failure here must never block the scan itself.
  }
}

export const POST = handler(async () => {
  await syncPreferencesIfDirty();

  const watches = parseWatchlist(readLines("watchlist.md"));
  const priority = parsePriorityCompanies(readLines("priority-companies.md"));
  const approved = loadCareerConfig().summer2027ApprovedCompanies;
  if (watches.length === 0 && priority.length === 0 && approved.length === 0) {
    return ok({ ran: false, reason: "no watches, priority companies, or approved companies" });
  }
  if (g.__rtWatchScanRunning) return ok({ ran: false, reason: "scan already running" });
  if (g.__rtLastWatchScan && Date.now() - g.__rtLastWatchScan < THROTTLE_MS) {
    return ok({ ran: false, reason: "throttled" });
  }

  const wanted = new Set([
    ...watches.map((w) => w.company.toLowerCase()),
    ...priority.map((c) => c.toLowerCase()),
    ...approved.map((c) => c.toLowerCase()),
    "amazon",
  ]);
  const companies = COMPANY_PORTALS.filter((p) => p.ats !== "unsupported" && wanted.has(p.name.toLowerCase())).map((p) => p.name);

  g.__rtWatchScanRunning = true;
  try {
    const summary = await runScraper({ companies, simplifyFeed: true });
    g.__rtLastWatchScan = Date.now();
    return ok({ ran: true, jobsFound: summary.jobsFound, newJobs: summary.newJobs });
  } finally {
    g.__rtWatchScanRunning = false;
  }
});

export const maxDuration = 300;
