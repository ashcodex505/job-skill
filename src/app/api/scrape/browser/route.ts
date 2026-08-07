import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { z } from "zod";
import { db } from "@/db";
import { handler, ok } from "@/lib/api";
import { parseBrowserCompanies } from "@/lib/career/browser-companies";
import { loadCareerConfig } from "@/lib/career/config";
import { notifyGoogleApplicationsOpened, notifyNewBrowserJobs } from "@/scraper/browser-alert";
import { loadBrowserScanSettings, saveBrowserScanSettings } from "@/scraper/browser-scan-settings";
import { isFreshEnough, scrapeBrowserCompanies } from "@/scraper/browser-scrape";
import {
  googleJobIdFromUrl,
  markGoogleApplicationsNotified,
  openUnnotifiedGoogleJobs,
  registerAndRefreshGoogleApplicationWatches,
} from "@/scraper/google-application-watch";
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
 * Throttle is user-configurable (default 30 min, see
 * browser-scan-settings.ts) relative to the existing local watch-scan
 * (~10 min) — each company here costs a full headless-Chromium page render
 * (seconds), not a JSON fetch (milliseconds), so polling it as aggressively
 * as the default would be both slow and impolite to the target sites.
 */
const g = globalThis as unknown as { __rtLastBrowserScan?: number; __rtBrowserScanRunning?: boolean };

function readCompaniesFile(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), "career", "browser-companies.md"), "utf8");
  } catch {
    return "";
  }
}

function settingsResponse(settings: ReturnType<typeof loadBrowserScanSettings>) {
  return { ...settings, lastRunAt: g.__rtLastBrowserScan ? new Date(g.__rtLastBrowserScan).toISOString() : null };
}

export const GET = handler(async () => ok(settingsResponse(loadBrowserScanSettings())));

const settingsInput = z.object({ intervalMinutes: z.number() });

export const PUT = handler(async (req: Request) => {
  const { intervalMinutes } = settingsInput.parse(await req.json());
  return ok(settingsResponse(saveBrowserScanSettings({ intervalMinutes })));
});

export const POST = handler(async () => {
  const companies = parseBrowserCompanies(readCompaniesFile());
  if (companies.length === 0) return ok({ ran: false, reason: "no browser-scan companies configured" });
  if (g.__rtBrowserScanRunning) return ok({ ran: false, reason: "scan already running" });
  const { intervalMinutes } = loadBrowserScanSettings();
  if (g.__rtLastBrowserScan && Date.now() - g.__rtLastBrowserScan < intervalMinutes * 60_000) {
    return ok({ ran: false, reason: "throttled" });
  }

  g.__rtBrowserScanRunning = true;
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const careerConfig = loadCareerConfig();
    const result = await scrapeBrowserCompanies(companies);
    const normalized = result.jobs.map((job) => normalizeJob(job, careerConfig)).filter((j): j is NormalizedJob => j !== null);
    // Freshness cutoff: only enforced where a real posted date is known
    // (currently Microsoft only — see parseRelativePostedAt). A posting
    // with no verifiable age passes through unchanged, same as before.
    const fresh = normalized.filter((j) => isFreshEnough(j.postedAt));
    const deduped = dedupeJobs(fresh);
    // No registry.ts entry exists for these companies (that's the whole
    // reason they're here) — no companyId FK to resolve, unlike the main
    // scrape path. The company NAME is still recorded on every row.
    const { newJobs } = await upsertNormalizedJobs(deduped, new Map());

    // Google can publish a real detail page before it accepts applications.
    // Keep those pages on the board, but gate their GitHub alert until the
    // exact Apply anchor appears. Other browser companies retain the normal
    // discovery-time alert behavior.
    const googleJobs = deduped.filter((job) => googleJobIdFromUrl(job.url));
    const googleState = await registerAndRefreshGoogleApplicationWatches(googleJobs);
    const notify = await notifyNewBrowserJobs(deduped.filter((job) => !googleJobIdFromUrl(job.url)));
    const googleNotify = await notifyGoogleApplicationsOpened(openUnnotifiedGoogleJobs(googleState));
    const notifiedAt = new Date().toISOString();
    if (googleNotify.notifiedUrls?.length) {
      await markGoogleApplicationsNotified(googleNotify.notifiedUrls, notifiedAt);
    }
    g.__rtLastBrowserScan = Date.now();
    return ok({
      ran: true,
      companiesScanned: result.scanned,
      jobsFound: deduped.length,
      newJobs,
      errors: result.errors,
      notify,
      googleApplicationNotify: googleNotify,
    });
  } finally {
    g.__rtBrowserScanRunning = false;
  }
});

// Headless-browser scans are slow (a real page render per company, plus
// jittered politeness delays) — give this route much more room than the
// default before Next.js/the platform would time it out.
export const maxDuration = 600;
