import fs from "node:fs";
import path from "node:path";

/**
 * User-configurable cadence for the local headless-browser scan — how often
 * POST /api/scrape/browser is allowed to actually run (both the server-side
 * throttle and the dashboard panel's own poll interval read this same
 * value). Pure local state, not git-synced like career/browser-companies.md
 * — this is a personal runtime preference, not shared project config.
 */
export interface BrowserScanSettings {
  intervalMinutes: number;
}

export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_SETTINGS: BrowserScanSettings = { intervalMinutes: 30 };
const SETTINGS_PATH = path.join(process.cwd(), "board", "browser-scan-settings.json");

/** Clamps to [MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES]; non-finite input falls back to the default. Exported for tests. */
export function clampIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.intervalMinutes;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(value)));
}

export function loadBrowserScanSettings(): BrowserScanSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return { intervalMinutes: clampIntervalMinutes(Number(parsed.intervalMinutes)) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveBrowserScanSettings(settings: BrowserScanSettings): BrowserScanSettings {
  const clamped: BrowserScanSettings = { intervalMinutes: clampIntervalMinutes(settings.intervalMinutes) };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(clamped, null, 1) + "\n", "utf8");
  return clamped;
}
