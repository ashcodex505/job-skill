import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/db";
import { handler, ok } from "@/lib/api";
import { parseBrowserCompanies } from "@/lib/career/browser-companies";
import { loadCareerConfig } from "@/lib/career/config";
import { notifyNewBrowserJobs } from "@/scraper/browser-alert";
import { scrapeBrowserCompanies } from "@/scraper/browser-scrape";
import { dedupeJobs, normalizeJob, type NormalizedJob } from "@/scraper/normalize";
import { upsertNormalizedJobs } from "@/scraper/run";

/**
 * Local-only headless-browser scan — see docs/browser-scraping.md for the
 * full design and why this exists as a completely separate path from the
 * JSON adapters. This route is the ONLY caller of scraper/browser-scrape.ts
 * anywhere in the app; nothing in .github/workflows/ can reach it, since
 * GitHub Actions never runs `next dev`/`next start` for this repo. It only
 * ever executes while you have the dashboard open on your own machine.
 *
 * Long throttle (default 30 min) relative to the existing local watch-scan
 * (~10 min) — each company here costs a full headless-Chromium page render
 * (seconds), not a JSON fetch (milliseconds), so polling it as aggressively
 * would be both slow and impolite to the target sites.
 */
const THROTTLE_MS = 30 * 60 * 1000;
const g = globalThis as unknown as { __rtLastBrowserScan?: number; __rtBrowserScanRunning?: boolean };

function readCompaniesFile(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), "career", "browser-companies.md"), "utf8");
  } catch {
    return "";
  }
}

export const POST = handler(async () => {
  const companies = parseBrowserCompanies(readCompaniesFile());
  if (companies.length === 0) return ok({ ran: false, reason: "no browser-scan companies configured" });
  if (g.__rtBrowserScanRunning) return ok({ ran: false, reason: "scan already running" });
  if (g.__rtLastBrowserScan && Date.now() - g.__rtLastBrowserScan < THROTTLE_MS) {
    return ok({ ran: false, reason: "throttled" });
  }

  g.__rtBrowserScanRunning = true;
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const careerConfig = loadCareerConfig();
    const result = await scrapeBrowserCompanies(companies);
    const normalized = result.jobs.map((job) => normalizeJob(job, careerConfig)).filter((j): j is NormalizedJob => j !== null);
    const deduped = dedupeJobs(normalized);
    // No registry.ts entry exists for these companies (that's the whole
    // reason they're here) — no companyId FK to resolve, unlike the main
    // scrape path. The company NAME is still recorded on every row.
    const { newJobs } = await upsertNormalizedJobs(deduped, new Map());
    const notify = await notifyNewBrowserJobs(deduped);
    g.__rtLastBrowserScan = Date.now();
    return ok({
      ran: true,
      companiesScanned: result.scanned,
      jobsFound: deduped.length,
      newJobs,
      errors: result.errors,
      notify,
    });
  } finally {
    g.__rtBrowserScanRunning = false;
  }
});

// Headless-browser scans are slow (a real page render per company, plus
// jittered politeness delays) — give this route much more room than the
// default before Next.js/the platform would time it out.
export const maxDuration = 600;
