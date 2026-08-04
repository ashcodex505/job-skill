import fs from "node:fs";
import path from "node:path";

/**
 * Cadence + on/off for BOTH the local live watch-scan (POST
 * /api/scrape/watch, shared by the Watchlist and Priority companies panels)
 * AND the CI "priority" job in .github/workflows/watch.yml. Two different
 * mechanisms reading one file, because a toggle that only stopped the local
 * ping while the CI cron kept firing every 30 min wouldn't actually be an
 * off switch.
 *
 * Unlike browser-scan-settings.ts (purely local, never read by CI), this
 * file MUST be git-synced — GitHub Actions checks out the repo fresh on
 * every run and only ever sees whatever was last pushed. The API route's
 * PUT handler commits and pushes on every change (see /api/scrape/watch),
 * same auto-sync pattern as career/priority-companies.md. That means a
 * toggle change here has real latency: it only takes effect once pushed,
 * and never for a CI run already in flight.
 *
 * ciIntervalMinutes doesn't change the cron schedule itself (GitHub Actions
 * schedules are static YAML, not runtime-configurable) — the workflow's
 * `priority` job checks this file and no-ops if disabled or if less than
 * ciIntervalMinutes has passed since lastCiRunAt, which it updates after
 * every real run. The cron still fires every 30 min regardless; a skipped
 * run just costs a few seconds of an Actions runner, not a real scrape.
 */
export interface WatchScanSettings {
  enabled: boolean;
  intervalMinutes: number;
  ciIntervalMinutes: number;
  /** ISO timestamp of the last real (non-skipped) CI priority run. Set by the workflow itself, not the dashboard. */
  lastCiRunAt: string | null;
}

export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_SETTINGS: WatchScanSettings = { enabled: true, intervalMinutes: 10, ciIntervalMinutes: 30, lastCiRunAt: null };
const SETTINGS_PATH = path.join(process.cwd(), "board", "watch-scan-settings.json");

/** Clamps to [MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES]; non-finite input falls back to the default. Exported for tests. */
export function clampIntervalMinutes(value: number, fallback = DEFAULT_SETTINGS.intervalMinutes): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(value)));
}

export function loadWatchScanSettings(): WatchScanSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return {
      enabled: parsed.enabled !== false,
      intervalMinutes: clampIntervalMinutes(Number(parsed.intervalMinutes), DEFAULT_SETTINGS.intervalMinutes),
      ciIntervalMinutes: clampIntervalMinutes(Number(parsed.ciIntervalMinutes), DEFAULT_SETTINGS.ciIntervalMinutes),
      lastCiRunAt: typeof parsed.lastCiRunAt === "string" ? parsed.lastCiRunAt : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Partial update — only overwrites the fields provided, preserving lastCiRunAt (owned by the CI workflow, never the dashboard). */
export function saveWatchScanSettings(patch: Partial<Omit<WatchScanSettings, "lastCiRunAt">>): WatchScanSettings {
  const current = loadWatchScanSettings();
  const next: WatchScanSettings = {
    enabled: patch.enabled ?? current.enabled,
    intervalMinutes: patch.intervalMinutes !== undefined ? clampIntervalMinutes(patch.intervalMinutes, current.intervalMinutes) : current.intervalMinutes,
    ciIntervalMinutes:
      patch.ciIntervalMinutes !== undefined ? clampIntervalMinutes(patch.ciIntervalMinutes, current.ciIntervalMinutes) : current.ciIntervalMinutes,
    lastCiRunAt: current.lastCiRunAt,
  };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 1) + "\n", "utf8");
  return next;
}
