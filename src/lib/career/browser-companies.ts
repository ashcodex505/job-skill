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
  /**
   * Some search-driven career sites (confirmed live: Apple) ignore a query
   * string on initial page load entirely — the underlying search only fires
   * once a real search box is filled and submitted. When set, the browser
   * scraper types this into whatever search input it can find and presses
   * Enter before reading the page. Optional — most sites (Microsoft, Meta)
   * accept the query as a plain URL param baked into careersUrl instead.
   */
  searchQuery?: string;
  /**
   * A company's own careers site rarely states a recruiting season in its
   * posting titles the way SimplifyJobs/vansh listings do ("Software
   * Engineer Intern" with no "Fall 2026") — confirmed live across Microsoft,
   * Meta, Google, and Apple. Without a season signal, an internship posting
   * is silently excluded by the internshipSeasons hard filter (never a false
   * positive — just invisible). This is the browser-scan equivalent of
   * RawJob.seasonHint, but declared by you per company rather than read from
   * a feed, since there's no structured source to read it from here.
   */
  seasonHint?: string;
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

const KEYED_SUFFIX_RE = /^(search|season):\s*(.*)$/i;

export function parseBrowserCompanies(markdown: string): BrowserCompanyEntry[] {
  const seen = new Set<string>();
  const out: BrowserCompanyEntry[] = [];
  for (const line of parseSection(markdown, "Browser scan")) {
    const [namePart, ...rest] = line.split("—").map((s) => s.trim());
    if (rest.length === 0) continue; // a line with no "— url" separator has nothing to scan
    const name = namePart;
    // Any trailing "— search: {query}" / "— season: {hint}" segments (any
    // order) declare optional fields; the remaining leading segment(s) are
    // the URL — see BrowserCompanyEntry.searchQuery / .seasonHint.
    let searchQuery: string | undefined;
    let seasonHint: string | undefined;
    const urlParts: string[] = [];
    for (const seg of rest) {
      const m = seg.match(KEYED_SUFFIX_RE);
      if (!m) {
        urlParts.push(seg);
        continue;
      }
      const value = m[2].trim() || undefined;
      if (m[1].toLowerCase() === "search") searchQuery = value;
      else seasonHint = value;
    }
    const careersUrl = urlParts.join(" — ");
    if (!name || !careersUrl) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, careersUrl, ...(searchQuery ? { searchQuery } : {}), ...(seasonHint ? { seasonHint } : {}) });
  }
  return out;
}

export function serializeBrowserCompanies(companies: BrowserCompanyEntry[]): string {
  const bullets = companies
    .map((c) => {
      let line = `- ${c.name} — ${c.careersUrl}`;
      if (c.searchQuery) line += ` — search: ${c.searchQuery}`;
      if (c.seasonHint) line += ` — season: ${c.seasonHint}`;
      return line;
    })
    .join("\n");
  return `${HEADER}\n${bullets}${bullets ? "\n" : ""}`;
}
