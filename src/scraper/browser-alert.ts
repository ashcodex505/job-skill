import { execFileSync } from "node:child_process";
import { filterUnalerted, recordAlerted } from "./big-tech-alert";
import type { BoardJob } from "./board";
import { loadBrowserAlertLedger, saveBrowserAlertLedger } from "./browser-alert-state";
import { renderNewJobsAlertTable } from "./job-alert";
import type { NormalizedJob } from "./normalize";

/**
 * Fires a real GitHub Issue for new browser-scan matches — the local-only
 * counterpart to what watch.yml/job-board.yml's `gh issue create` steps do
 * in CI. CI has `GH_TOKEN: ${{ github.token }}` for free; nothing analogous
 * exists on your machine, so this shells out to `git credential fill`
 * (same mechanism, same security rule as every other local GitHub API call
 * in this project: the token is read into a variable and used directly in
 * the Authorization header, NEVER printed, logged, or written to a file).
 *
 * Deliberately NOT via the `gh` CLI itself — `gh auth status` for this
 * machine resolves to a different GitHub account than the one with push
 * access to this repo, so `gh issue create` would silently try (and fail)
 * as the wrong account. A raw REST call with a credential-store token
 * sidesteps that entirely.
 *
 * Local-only, same isolation discipline as browser-scrape.ts itself: only
 * ever imported by src/app/api/scrape/browser/route.ts.
 */

function getGitHubToken(): string | null {
  try {
    const output = execFileSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      timeout: 10_000,
    });
    const match = output.match(/^password=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/** Parses "owner/repo" out of the local `origin` remote URL (https or ssh form). Exported for tests. */
export function parseOwnerRepo(remoteUrl: string): string | null {
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function getOwnerRepo(): string | null {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", timeout: 5_000 }).trim();
    return parseOwnerRepo(url);
  } catch {
    return null;
  }
}

async function createGitHubIssue(ownerRepo: string, token: string, title: string, body: string, labels: string[]): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${ownerRepo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, labels }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub issue create failed: ${res.status} ${detail.slice(0, 300)}`);
  }
}

export interface BrowserNotifyResult {
  notified: boolean;
  reason?: string;
  issueJobCount?: number;
}

/**
 * Notifies (once) about every job in `jobs` not already in the browser-scan
 * alert ledger. Safe to call every scan — the ledger means a job already
 * alerted on never fires a second issue, matching the "never alert twice"
 * rule the rest of this repo's notification streams already follow.
 */
export async function notifyNewBrowserJobs(jobs: NormalizedJob[], now: string = new Date().toISOString()): Promise<BrowserNotifyResult> {
  if (jobs.length === 0) return { notified: false, reason: "no relevant jobs this scan" };

  const boardJobs: BoardJob[] = jobs.map((j) => ({
    dedupeKey: j.dedupeKey,
    source: j.source,
    company: j.company,
    title: j.title,
    location: j.location,
    url: j.url,
    season: j.season,
    roleType: j.roleType,
    score: j.score,
    matchedSkills: j.matchedSkills,
    breakdown: j.breakdown,
    postedAt: j.postedAt,
    firstSeenAt: now,
  }));

  const ledger = loadBrowserAlertLedger();
  const unalerted = filterUnalerted(ledger, boardJobs);
  if (unalerted.length === 0) return { notified: false, reason: "already alerted on every match" };

  const ownerRepo = getOwnerRepo();
  if (!ownerRepo) return { notified: false, reason: "couldn't resolve the origin remote's owner/repo" };
  const token = getGitHubToken();
  if (!token) return { notified: false, reason: "no GitHub credential available via `git credential fill`" };

  const title =
    unalerted.length === 1
      ? `🖥️ Browser scan: ${unalerted[0].company} — ${unalerted[0].title}`.replace(/[\r\n]/g, " ").slice(0, 150)
      : `🖥️ Browser scan: ${unalerted.length} new matches`;
  const body = `cc @${ownerRepo.split("/")[0]} — new matches from the local headless-browser scan (Microsoft/Meta/Google/Apple/etc.).\n\n${renderNewJobsAlertTable(unalerted, now)}`;

  await createGitHubIssue(ownerRepo, token, title, body, ["browser-scan"]);
  saveBrowserAlertLedger(recordAlerted(ledger, unalerted, now));
  return { notified: true, issueJobCount: unalerted.length };
}
