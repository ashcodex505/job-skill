import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { handler, ok } from "@/lib/api";
import { parsePriorityCompanies } from "@/lib/career/priority";
import { parseWatchlist } from "@/lib/career/watchlist";
import { COMPANY_PORTALS } from "@/scraper/registry";
import { runScraper } from "@/scraper/run";
import { loadWatchScanSettings, saveWatchScanSettings } from "@/scraper/watch-scan-settings";

/**
 * Lightweight local watch-scan, triggered by the dashboard watchlist panel
 * while it's open: scrapes watched + priority supported companies, plus the
 * community feeds, into the local DB so the panel's poll can surface
 * brand-new matches without a manual scrape. Cadence + on/off is
 * user-configurable (default 10 min local / 30 min CI, see
 * watch-scan-settings.ts) — the Watchlist and Priority companies panels
 * both trigger this same endpoint, so both read the same persisted value
 * for their own poll timers.
 *
 * Unlike browser-scan-settings.ts, this settings file must reach CI (the
 * `priority` job in .github/workflows/watch.yml reads it to decide whether
 * to no-op) — so, unlike that file, every PUT here also commits and pushes,
 * same auto-sync pattern as career/priority-companies.md. A toggle change
 * has real latency: it only takes effect once pushed, and never for a CI
 * run already in flight.
 */
const execFileAsync = promisify(execFile);
const g = globalThis as unknown as { __rtLastWatchScan?: number; __rtWatchScanRunning?: boolean };
const SETTINGS_REPO_PATH = "board/watch-scan-settings.json";

function readLines(file: string): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), "career", file), "utf8");
  } catch {
    return "";
  }
}

function settingsResponse(settings: ReturnType<typeof loadWatchScanSettings>) {
  return { ...settings, lastRunAt: g.__rtLastWatchScan ? new Date(g.__rtLastWatchScan).toISOString() : null };
}

/** Same auto-sync pattern as the browser-companies/priority-companies routes — see their comments for the retry rationale. */
async function gitSync(): Promise<string | null> {
  const git = (args: string[]) => execFileAsync("git", args, { cwd: process.cwd(), timeout: 60_000 });
  try {
    await git(["add", "--", SETTINGS_REPO_PATH]);
    try {
      await git(["commit", "-m", "chore: update watch-scan settings from dashboard", "--", SETTINGS_REPO_PATH]);
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
    return `Auto-sync to GitHub failed (${detail}) — CI won't see this change until board/watch-scan-settings.json is pushed manually.`;
  }
}

export const GET = handler(async () => ok(settingsResponse(loadWatchScanSettings())));

const settingsInput = z.object({ enabled: z.boolean().optional(), intervalMinutes: z.number().optional(), ciIntervalMinutes: z.number().optional() });

export const PUT = handler(async (req: Request) => {
  const patch = settingsInput.parse(await req.json());
  const settings = saveWatchScanSettings(patch);
  const syncError = await gitSync();
  return ok({ ...settingsResponse(settings), syncError });
});

export const POST = handler(async () => {
  const settings = loadWatchScanSettings();
  if (!settings.enabled) return ok({ ran: false, reason: "disabled via dashboard toggle" });
  const watches = parseWatchlist(readLines("watchlist.md"));
  const priority = parsePriorityCompanies(readLines("priority-companies.md"));
  if (watches.length === 0 && priority.length === 0) return ok({ ran: false, reason: "no watches or priority companies" });
  if (g.__rtWatchScanRunning) return ok({ ran: false, reason: "scan already running" });
  if (g.__rtLastWatchScan && Date.now() - g.__rtLastWatchScan < settings.intervalMinutes * 60_000) {
    return ok({ ran: false, reason: "throttled" });
  }

  const wanted = new Set([...watches.map((w) => w.company.toLowerCase()), ...priority.map((c) => c.toLowerCase()), "amazon"]);
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
