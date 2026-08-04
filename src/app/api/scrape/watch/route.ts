import fs from "node:fs";
import path from "node:path";
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
 * brand-new matches without a manual scrape. Cadence is user-configurable
 * (default 10 min, see watch-scan-settings.ts) — the Watchlist and Priority
 * companies panels both trigger this same endpoint, so both read the same
 * persisted value for their own poll timers, same pattern as
 * browser-scan-settings.ts. Priority companies get that same coverage
 * class as Amazon from CI while the dashboard is open; CI is what covers
 * them the rest of the time.
 */
const g = globalThis as unknown as { __rtLastWatchScan?: number; __rtWatchScanRunning?: boolean };

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

export const GET = handler(async () => ok(settingsResponse(loadWatchScanSettings())));

const settingsInput = z.object({ intervalMinutes: z.number() });

export const PUT = handler(async (req: Request) => {
  const { intervalMinutes } = settingsInput.parse(await req.json());
  return ok(settingsResponse(saveWatchScanSettings({ intervalMinutes })));
});

export const POST = handler(async () => {
  const watches = parseWatchlist(readLines("watchlist.md"));
  const priority = parsePriorityCompanies(readLines("priority-companies.md"));
  if (watches.length === 0 && priority.length === 0) return ok({ ran: false, reason: "no watches or priority companies" });
  if (g.__rtWatchScanRunning) return ok({ ran: false, reason: "scan already running" });
  const { intervalMinutes } = loadWatchScanSettings();
  if (g.__rtLastWatchScan && Date.now() - g.__rtLastWatchScan < intervalMinutes * 60_000) {
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
