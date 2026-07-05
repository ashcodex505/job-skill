import { parseSection } from "./markdown";

/**
 * Watchlist: "tell me the moment a role like this opens". Stored in
 * career/watchlist.md so the CI watch run reads the committed copy, but the
 * file is APP-MANAGED — the dashboard UI is the only add/remove surface
 * (deliberately not wired into the plain-English career editor).
 *
 * Pure parse/serialize/match only — file I/O lives in the API route and CLIs.
 */

export interface Watch {
  /** Company name, or "Any" to match on keywords alone. */
  company: string;
  /** Space-separated keywords; ALL must appear in the job title. */
  keywords: string;
}

export const ANY_COMPANY = "Any";

const HEADER = `<!-- APP-MANAGED FILE: edited by the Resume Tracker dashboard (Watchlist section).
     Do not edit by hand and do not wire into the plain-English career editor —
     manual edits will be overwritten by the next add/remove in the app. -->

# Watchlist

Roles to alert on the moment they appear. Managed from the dashboard;
the hourly CI watch run reads the committed copy of this file.

## Watches
`;

export function parseWatchlist(markdown: string): Watch[] {
  return parseSection(markdown, "Watches")
    .map((line) => {
      const [company, ...rest] = line.split("—").map((s) => s.trim());
      // Lines without the em-dash separator are treated as Any-company keywords.
      if (rest.length === 0) return { company: ANY_COMPANY, keywords: company };
      return { company: company || ANY_COMPANY, keywords: rest.join(" — ") };
    })
    .filter((w) => w.keywords.trim().length > 0);
}

export function serializeWatchlist(watches: Watch[]): string {
  const bullets = watches.map((w) => `- ${w.company} — ${w.keywords}`).join("\n");
  return `${HEADER}\n${bullets}${bullets ? "\n" : ""}`;
}

export function watchEquals(a: Watch, b: Watch): boolean {
  return (
    a.company.trim().toLowerCase() === b.company.trim().toLowerCase() &&
    a.keywords.trim().toLowerCase() === b.keywords.trim().toLowerCase()
  );
}

export interface WatchableJob {
  company: string;
  title: string;
}

/** True when the job satisfies the watch: company matches (or Any) and every keyword appears in the title. */
export function matchesWatch(watch: Watch, job: WatchableJob): boolean {
  if (watch.company !== ANY_COMPANY && watch.company.trim().toLowerCase() !== job.company.trim().toLowerCase()) {
    return false;
  }
  const title = job.title.toLowerCase();
  const words = watch.keywords.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => title.includes(w));
}

/** Jobs matching ANY watch, de-duplicated, preserving input order. */
export function matchWatches<T extends WatchableJob>(watches: Watch[], jobs: T[]): T[] {
  if (watches.length === 0) return [];
  return jobs.filter((job) => watches.some((w) => matchesWatch(w, job)));
}
