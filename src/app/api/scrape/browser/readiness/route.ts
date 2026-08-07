import { migrate } from "drizzle-orm/libsql/migrator";
import { z } from "zod";
import { db } from "@/db";
import { badRequest, handler, ok } from "@/lib/api";
import { loadCareerConfig } from "@/lib/career/config";
import { notifyGoogleApplicationsOpened, type BrowserNotifyResult } from "@/scraper/browser-alert";
import {
  canonicalGoogleJobUrl,
  GOOGLE_APPLICATION_POLL_MS,
  googleJobIdFromUrl,
  loadGoogleApplicationWatchState,
  markGoogleApplicationsNotified,
  openUnnotifiedGoogleJobs,
  probeGoogleApplication,
  refreshGoogleApplicationWatches,
  registerAndRefreshGoogleApplicationWatches,
  removeManualGoogleApplicationWatch,
  type GoogleApplicationWatchState,
} from "@/scraper/google-application-watch";
import { normalizeJob, type RawJob } from "@/scraper/normalize";
import { upsertNormalizedJobs } from "@/scraper/run";

const g = globalThis as unknown as {
  __rtLastGoogleReadinessScan?: number;
  __rtGoogleReadinessScanRunning?: boolean;
};

function response(state: GoogleApplicationWatchState = loadGoogleApplicationWatchState(), extra: Record<string, unknown> = {}) {
  return ok({
    intervalMinutes: GOOGLE_APPLICATION_POLL_MS / 60_000,
    lastRunAt: g.__rtLastGoogleReadinessScan ? new Date(g.__rtLastGoogleReadinessScan).toISOString() : null,
    entries: Object.values(state.entries).sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt)),
    ...extra,
  });
}

async function notifyOpenJobs(state: GoogleApplicationWatchState): Promise<BrowserNotifyResult> {
  const jobs = openUnnotifiedGoogleJobs(state);
  if (jobs.length === 0) return { notified: false, reason: "no newly opened Google applications" };
  await migrate(db, { migrationsFolder: "./drizzle" });
  await upsertNormalizedJobs(jobs, new Map());
  try {
    const notify = await notifyGoogleApplicationsOpened(jobs);
    if (notify.notifiedUrls?.length) {
      await markGoogleApplicationsNotified(notify.notifiedUrls, new Date().toISOString());
    }
    return notify;
  } catch (error) {
    // The persisted entry stays open + unnotified, so the next 10-minute
    // tick retries instead of losing the transition.
    return { notified: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export const GET = handler(async () => response());

export const POST = handler(async () => {
  if (g.__rtGoogleReadinessScanRunning) return response(undefined, { ran: false, reason: "scan already running" });
  if (g.__rtLastGoogleReadinessScan && Date.now() - g.__rtLastGoogleReadinessScan < GOOGLE_APPLICATION_POLL_MS) {
    return response(undefined, { ran: false, reason: "throttled" });
  }

  g.__rtGoogleReadinessScanRunning = true;
  try {
    const state = await refreshGoogleApplicationWatches();
    const notify = await notifyOpenJobs(state);
    g.__rtLastGoogleReadinessScan = Date.now();
    return response(loadGoogleApplicationWatchState(), { ran: true, notify });
  } finally {
    g.__rtGoogleReadinessScanRunning = false;
  }
});

const addInput = z.object({ url: z.string().trim().url().max(1_000) });

export const PUT = handler(async (req: Request) => {
  const { url } = addInput.parse(await req.json());
  const canonicalUrl = canonicalGoogleJobUrl(url);
  const jobId = googleJobIdFromUrl(url);
  if (!canonicalUrl || !jobId) return badRequest("Enter a Google Careers job-detail URL");

  const probe = await probeGoogleApplication(canonicalUrl);
  if (probe.kind === "error") return badRequest(`Could not inspect that Google job: ${probe.message}`);
  if (probe.kind === "unavailable") return badRequest(`That Google job is not currently available: ${probe.reason}`);
  if (!probe.title) return badRequest("Google returned the job page without a readable title");

  const raw: RawJob = {
    source: "browser",
    sourceId: null,
    company: "Google",
    title: probe.title,
    location: null,
    url: canonicalUrl,
    postedAt: null,
    description: null,
    seasonHint: null,
  };
  const job = normalizeJob(raw, loadCareerConfig());
  if (!job) return badRequest("That role does not match the current career title/season policy");

  await migrate(db, { migrationsFolder: "./drizzle" });
  await upsertNormalizedJobs([job], new Map());
  const state = await registerAndRefreshGoogleApplicationWatches([job], {
    manuallyWatched: true,
    force: true,
    initialProbes: { [jobId]: probe },
  });
  const notify = await notifyOpenJobs(state);
  return response(loadGoogleApplicationWatchState(), { added: true, notify });
});

export const DELETE = handler(async (req: Request) => {
  const { jobId } = z.object({ jobId: z.string().regex(/^\d+$/) }).parse(await req.json());
  const current = loadGoogleApplicationWatchState().entries[jobId];
  if (!current?.manuallyWatched) return badRequest("Only links added directly in the dashboard can be removed here");
  return response(await removeManualGoogleApplicationWatch(jobId), { removed: true });
});

export const maxDuration = 120;
