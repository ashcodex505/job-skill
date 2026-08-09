import { z } from "zod";
import { handler, ok } from "@/lib/api";
import { notifyLocalWatchJobs, type LocalWatchNotifyResult } from "@/scraper/local-watch-alert";
import { loadLocalWatchSettings, saveLocalWatchSettings } from "@/scraper/local-watch-settings";
import { runScraper } from "@/scraper/run";

/**
 * Dashboard-only full supported-source scan. While the dashboard is open it
 * runs every configured interval, scanning every real registry API adapter
 * plus all community feeds. Registry entries marked unsupported are excluded
 * because the separate Browser Scan owns those rendered career pages.
 *
 * runScraper reloads career/preferences.md every run, so its title, season,
 * location, freshness, and approved-company policy is identical to CI.
 * Newly inserted jobs are stored normally, but only postings with a confirmed
 * date no more than two days old can create a `local-watch` issue. Its URL
 * ledger is shared with CI's urgent/big-tech streams, with a semantic
 * company/title/location/season fallback, so one opportunity is notified once.
 */
const g = globalThis as unknown as { __rtLastWatchScan?: number; __rtWatchScanRunning?: boolean };

function settingsResponse(settings = loadLocalWatchSettings()) {
  return { ...settings, lastRunAt: g.__rtLastWatchScan ? new Date(g.__rtLastWatchScan).toISOString() : null };
}

export const GET = handler(async () => ok(settingsResponse()));

const settingsInput = z.object({ intervalMinutes: z.number() });

export const PUT = handler(async (req: Request) => {
  const { intervalMinutes } = settingsInput.parse(await req.json());
  return ok(settingsResponse(saveLocalWatchSettings({ intervalMinutes })));
});

export const POST = handler(async () => {
  if (g.__rtWatchScanRunning) return ok({ ran: false, reason: "scan already running" });
  const { intervalMinutes } = loadLocalWatchSettings();
  if (g.__rtLastWatchScan && Date.now() - g.__rtLastWatchScan < intervalMinutes * 60_000) {
    return ok({ ran: false, reason: "throttled" });
  }

  g.__rtWatchScanRunning = true;
  try {
    // No company filter = every supported adapter; feeds join full runs by default.
    const summary = await runScraper();
    let notify: LocalWatchNotifyResult;
    try {
      notify = await notifyLocalWatchJobs(summary.jobs, summary.newJobKeys);
    } catch (error) {
      notify = { notified: false, reason: error instanceof Error ? error.message : String(error) };
    }
    g.__rtLastWatchScan = Date.now();
    return ok({
      ran: true,
      companiesScanned: summary.companiesScanned,
      jobsFound: summary.jobsFound,
      newJobs: summary.newJobs,
      sourceErrors: summary.errors.length,
      notify,
      ...settingsResponse(),
    });
  } finally {
    g.__rtWatchScanRunning = false;
  }
});

export const maxDuration = 300;
