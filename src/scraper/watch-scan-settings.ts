import fs from "node:fs";
import path from "node:path";

/**
 * User-configurable cadence for the local live watch-scan
 * (POST /api/scrape/watch) — shared by the Watchlist and Priority companies
 * panels, since both trigger the same endpoint. Same pattern as
 * browser-scan-settings.ts: one persisted value read by both the server
 * throttle and every panel's own poll timer, so they can't drift apart.
 */
export interface WatchScanSettings {
  intervalMinutes: number;
}

export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_SETTINGS: WatchScanSettings = { intervalMinutes: 10 };
const SETTINGS_PATH = path.join(process.cwd(), "board", "watch-scan-settings.json");

/** Clamps to [MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES]; non-finite input falls back to the default. Exported for tests. */
export function clampIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.intervalMinutes;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(value)));
}

export function loadWatchScanSettings(): WatchScanSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return { intervalMinutes: clampIntervalMinutes(Number(parsed.intervalMinutes)) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveWatchScanSettings(settings: WatchScanSettings): WatchScanSettings {
  const clamped: WatchScanSettings = { intervalMinutes: clampIntervalMinutes(settings.intervalMinutes) };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(clamped, null, 1) + "\n", "utf8");
  return clamped;
}
