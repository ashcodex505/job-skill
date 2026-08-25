import { parseSection } from "./markdown";

/**
 * Priority companies: "check this one every 30–60 minutes, not just every
 * 12 hours". Stored in career/priority-companies.md so the unified CI watch
 * job reads the committed copy, but the file is APP-MANAGED —
 * the dashboard UI is the only add/remove surface.
 *
 * Amazon is always scraped on the fast lane regardless of this list (see
 * board-cli.ts --watch) — this file only ever ADDS companies on top of
 * that baseline, so removing everything here can't silently disable it.
 *
 * Only companies with a real ATS adapter (registry.ts, ats !== "unsupported")
 * are eligible: a frequent check is only meaningful when there's an actual
 * API to call. Validation happens where the file is written (the API route),
 * not here — this module stays a pure parse/serialize, like watchlist.ts.
 */

const HEADER = `<!-- APP-MANAGED FILE: edited by the Resume Tracker dashboard (Priority companies section).
     Do not edit by hand — manual edits will be overwritten by the next
     add/remove in the app. -->

# Priority companies

Companies checked every 30–60 minutes instead of the default 12-hour sweep.
Amazon is always included on the fast lane and does not need to be listed
here. Managed from the dashboard; the unified CI job in watch.yml reads
the committed copy of this file.

## Priority
`;

export function parsePriorityCompanies(markdown: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of parseSection(markdown, "Priority")) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function serializePriorityCompanies(companies: string[]): string {
  const bullets = companies.map((c) => `- ${c}`).join("\n");
  return `${HEADER}\n${bullets}${bullets ? "\n" : ""}`;
}
