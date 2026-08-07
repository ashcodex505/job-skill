import fs from "node:fs";
import path from "node:path";

/**
 * Personal runtime settings for the dashboard-only API/feed watcher. These
 * live under data/ (already gitignored) because changing a local polling
 * preference must never dirty or auto-sync the repository.
 */
export interface LocalWatchSettings {
  intervalMinutes: number;
}

export const MIN_LOCAL_WATCH_INTERVAL_MINUTES = 30;
export const MAX_LOCAL_WATCH_INTERVAL_MINUTES = 24 * 60;
export const DEFAULT_LOCAL_WATCH_INTERVAL_MINUTES = 30;

const SETTINGS_PATH = path.join(process.cwd(), "data", "local-watch-settings.json");

export function clampLocalWatchIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LOCAL_WATCH_INTERVAL_MINUTES;
  return Math.min(
    MAX_LOCAL_WATCH_INTERVAL_MINUTES,
    Math.max(MIN_LOCAL_WATCH_INTERVAL_MINUTES, Math.round(value)),
  );
}

export function loadLocalWatchSettings(): LocalWatchSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return { intervalMinutes: clampLocalWatchIntervalMinutes(Number(parsed.intervalMinutes)) };
  } catch {
    return { intervalMinutes: DEFAULT_LOCAL_WATCH_INTERVAL_MINUTES };
  }
}

export function saveLocalWatchSettings(settings: LocalWatchSettings): LocalWatchSettings {
  const saved = { intervalMinutes: clampLocalWatchIntervalMinutes(settings.intervalMinutes) };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(saved, null, 1)}\n`, "utf8");
  return saved;
}
