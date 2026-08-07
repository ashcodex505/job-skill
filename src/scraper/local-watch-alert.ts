import { execFileSync } from "node:child_process";
import { filterUnalerted, recordAlerted } from "./big-tech-alert";
import type { BoardJob } from "./board";
import { renderNewJobsAlertTable } from "./job-alert";
import { loadLocalWatchAlertState, saveLocalWatchAlertState } from "./local-watch-alert-state";
import type { LocalWatchAlertState } from "./local-watch-alert-state";
import type { NormalizedJob } from "./normalize";

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

export function parseOwnerRepo(remoteUrl: string): string | null {
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

function getOwnerRepo(): string | null {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
    return parseOwnerRepo(url);
  } catch {
    return null;
  }
}

async function githubRequest(ownerRepo: string, token: string, path: string, init: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com/repos/${ownerRepo}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

/** Ensure the requested label exists before issue creation. */
async function ensureLocalWatchLabel(ownerRepo: string, token: string): Promise<void> {
  const encoded = encodeURIComponent("local-watch");
  const existing = await githubRequest(ownerRepo, token, `/labels/${encoded}`, { method: "GET" });
  if (existing.ok) return;
  if (existing.status !== 404) {
    throw new Error(`GitHub label lookup failed: ${existing.status}`);
  }

  const created = await githubRequest(ownerRepo, token, "/labels", {
    method: "POST",
    body: JSON.stringify({
      name: "local-watch",
      color: "1d76db",
      description: "New eligible job found by the dashboard-only API and feed watcher",
    }),
  });
  // 422 can mean another request created the label between GET and POST.
  if (!created.ok && created.status !== 422) {
    const detail = await created.text().catch(() => "");
    throw new Error(`GitHub label create failed: ${created.status} ${detail.slice(0, 300)}`);
  }
}

async function createGitHubIssue(ownerRepo: string, token: string, title: string, body: string): Promise<void> {
  await ensureLocalWatchLabel(ownerRepo, token);
  const response = await githubRequest(ownerRepo, token, "/issues", {
    method: "POST",
    body: JSON.stringify({ title, body, labels: ["local-watch"] }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub issue create failed: ${response.status} ${detail.slice(0, 300)}`);
  }
}

export interface LocalWatchNotifyResult {
  notified: boolean;
  reason?: string;
  issueJobCount?: number;
}

function toBoardJobs(jobs: NormalizedJob[], now: string): BoardJob[] {
  return jobs.map((job) => ({
    dedupeKey: job.dedupeKey,
    source: job.source,
    company: job.company,
    title: job.title,
    location: job.location,
    url: job.url,
    season: job.season,
    roleType: job.roleType,
    score: job.score,
    matchedSkills: job.matchedSkills,
    breakdown: job.breakdown,
    postedAt: job.postedAt,
    firstSeenAt: now,
  }));
}

export function mergePendingLocalWatchJobs(
  state: LocalWatchAlertState,
  jobs: BoardJob[],
  newJobKeys: string[],
): LocalWatchAlertState {
  const newKeys = new Set(newJobKeys);
  const pendingByKey = new Map(state.pending.map((job) => [job.dedupeKey, job]));
  for (const job of jobs) {
    if (newKeys.has(job.dedupeKey)) pendingByKey.set(job.dedupeKey, job);
  }
  return {
    initialized: state.initialized,
    alerted: state.alerted,
    pending: filterUnalerted(state.alerted, [...pendingByKey.values()]),
  };
}

/**
 * Notify once for each eligible job inserted by a local API/feed scan.
 * Pending job details are saved before the GitHub request so an
 * auth/network failure is retried later without treating old database rows
 * as brand-new.
 */
export async function notifyLocalWatchJobs(
  jobs: NormalizedJob[],
  newJobKeys: string[],
  now: string = new Date().toISOString(),
): Promise<LocalWatchNotifyResult> {
  const boardJobs = toBoardJobs(jobs, now);
  let state = loadLocalWatchAlertState();
  if (!state.initialized && boardJobs.length > 0) {
    // A completely empty database makes the entire current job universe look
    // "new". Baseline that one bootstrap run instead of creating a giant
    // historical issue; an established DB still queues only genuinely new rows.
    const newKeys = new Set(newJobKeys);
    if (boardJobs.every((job) => newKeys.has(job.dedupeKey))) {
      state.alerted = recordAlerted(state.alerted, boardJobs, now);
    }
    state.initialized = true;
  }
  state = mergePendingLocalWatchJobs(state, boardJobs, newJobKeys);
  // Save before any credential or network operation: failures remain retryable.
  saveLocalWatchAlertState(state);

  const unalerted = state.pending;
  if (unalerted.length === 0) {
    return { notified: false, reason: "no new eligible opportunities" };
  }

  const ownerRepo = getOwnerRepo();
  if (!ownerRepo) return { notified: false, reason: "couldn't resolve the origin remote's owner/repo" };
  const token = getGitHubToken();
  if (!token) return { notified: false, reason: "no GitHub credential available via `git credential fill`" };

  const title =
    unalerted.length === 1
      ? `🔔 Local watch: ${unalerted[0].company} — ${unalerted[0].title}`.replace(/[\r\n]/g, " ").slice(0, 150)
      : `🔔 Local watch: ${unalerted.length} new opportunities`;
  const body = `cc @${ownerRepo.split("/")[0]} — new eligible opportunities from the local dashboard scan of supported API adapters and community job repositories.\n\n${renderNewJobsAlertTable(unalerted, now)}`;

  await createGitHubIssue(ownerRepo, token, title, body);
  state.alerted = recordAlerted(state.alerted, unalerted, now);
  state.pending = [];
  saveLocalWatchAlertState(state);
  return { notified: true, issueJobCount: unalerted.length };
}
