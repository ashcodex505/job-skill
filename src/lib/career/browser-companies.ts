import { parseSection } from "./markdown";

/**
 * Headless-browser scan targets — see docs/browser-scraping.md for the full
 * design. Stored in career/browser-companies.md so the list is versioned and
 * editable like watchlist.md/priority-companies.md, but the file is
 * APP-MANAGED — the dashboard UI is the only add/remove surface.
 *
 * Unlike priority-companies.md (which only needs a name matching an existing
 * registry.ts entry), each entry here needs its own careers URL — these are
 * companies with NO registry entry at all (no public API exists), so there's
 * nothing in registry.ts to cross-reference.
 *
 * This list is read ONLY by src/app/api/scrape/browser/route.ts, which is
 * only ever reachable while the local Next.js server is running — nothing
 * in .github/workflows/ ever reads this file. Pure parse/serialize only,
 * like watchlist.ts; file I/O lives in the API route.
 */

export interface BrowserCompanyEntry {
  name: string;
  careersUrl: string;
}

const HEADER = `<!-- APP-MANAGED FILE: edited by the Resume Tracker dashboard (Browser scan section).
     Do not edit by hand — manual edits will be overwritten by the next
     add/remove in the app. -->

# Browser scan companies

Companies with no public API (Google, Apple, Meta, and similar) checked via
local headless-browser scraping instead — see docs/browser-scraping.md.
This ONLY ever runs on your own machine while the dashboard is open; it is
never part of any GitHub Actions workflow. Managed from the dashboard.

## Browser scan
`;

export function parseBrowserCompanies(markdown: string): BrowserCompanyEntry[] {
  const seen = new Set<string>();
  const out: BrowserCompanyEntry[] = [];
  for (const line of parseSection(markdown, "Browser scan")) {
    const [namePart, ...rest] = line.split("—").map((s) => s.trim());
    if (rest.length === 0) continue; // a line with no "— url" separator has nothing to scan
    const name = namePart;
    const careersUrl = rest.join(" — ");
    if (!name || !careersUrl) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, careersUrl });
  }
  return out;
}

export function serializeBrowserCompanies(companies: BrowserCompanyEntry[]): string {
  const bullets = companies.map((c) => `- ${c.name} — ${c.careersUrl}`).join("\n");
  return `${HEADER}\n${bullets}${bullets ? "\n" : ""}`;
}
