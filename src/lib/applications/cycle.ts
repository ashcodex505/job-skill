/**
 * Which hiring cycle an application belongs to, for the dashboard's
 * "current cycle only" filter (Applications/Kanban/etc. still show
 * everything — this is dashboard-only).
 *
 * CSV imports (Simplify and similar trackers) never set `season`, and
 * `dateApplied` is when YOU applied, not the role's cycle — a Nov 2024
 * apply date and a "Summer 2025" title both mean the same (now-stale) 2025
 * cycle. So: prefer a 20xx year mentioned in season/title (however it's
 * phrased — "Summer 2025", "SDE Intern 2025", "2025 New Grad" all match),
 * and only fall back to the applied/created date when no year appears
 * anywhere in the text.
 */
const YEAR_RE = /\b(20\d{2})\b/;

export interface CycleSource {
  jobTitle: string;
  season: string | null;
  dateApplied: string | null;
  createdAt: string;
}

export function applicationCycleYear(app: CycleSource): number {
  const fromSeason = app.season?.match(YEAR_RE)?.[1];
  if (fromSeason) return Number(fromSeason);
  const fromTitle = app.jobTitle.match(YEAR_RE)?.[1];
  if (fromTitle) return Number(fromTitle);
  const fallback = new Date(app.dateApplied ?? app.createdAt);
  return Number.isFinite(fallback.getTime()) ? fallback.getUTCFullYear() : new Date().getUTCFullYear();
}

/** Current cycle onward — no hardcoded cutoff, so it stays correct next year too. */
export function isCurrentCycle(app: CycleSource, refYear: number = new Date().getUTCFullYear()): boolean {
  return applicationCycleYear(app) >= refYear;
}
