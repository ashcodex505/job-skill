import fs from "node:fs";
import path from "node:path";
import { handler, ok } from "@/lib/api";
import { parsePriorityCompanies } from "@/lib/career/priority";
import { parseWatchlist } from "@/lib/career/watchlist";
import { COMPANY_PORTALS } from "@/scraper/registry";
import { runScraper } from "@/scraper/run";

/**
 * Lightweight local watch-scan, triggered by the dashboard watchlist panel
 * while it's open: scrapes watched + priority supported companies, plus the
 * SimplifyJobs feed, into the local DB so the panel's poll can surface
 * brand-new matches without a manual scrape. Server-side throttle keeps
 * repeated panel ticks (every 5 min) from hammering the ATS APIs — effective
 * scan rate ~10 min. Priority companies get the same 30-min-class coverage
 * as Amazon from CI while the dashboard is open; CI is what covers them the
 * rest of the time.
 */
const THROTTLE_MS = 9.5 * 60 * 1000;
const g = globalThis as unknown as { __rtLastWatchScan?: number; __rtWatchScanRunning?: boolean };

function readLines(file: string): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), "career", file), "utf8");
  } catch {
    return "";
  }
}

export const POST = handler(async () => {
  const watches = parseWatchlist(readLines("watchlist.md"));
  const priority = parsePriorityCompanies(readLines("priority-companies.md"));
  if (watches.length === 0 && priority.length === 0) return ok({ ran: false, reason: "no watches or priority companies" });
  if (g.__rtWatchScanRunning) return ok({ ran: false, reason: "scan already running" });
  if (g.__rtLastWatchScan && Date.now() - g.__rtLastWatchScan < THROTTLE_MS) {
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
