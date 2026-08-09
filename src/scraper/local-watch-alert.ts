import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { recordAlerted } from "./big-tech-alert";
import type { AlertLedger } from "./big-tech-alert";
import type { BoardJob } from "./board";
import { renderNewJobsAlertTable } from "./job-alert";
import { loadLocalWatchAlertState, saveLocalWatchAlertState } from "./local-watch-alert-state";
import type { LocalWatchAlertState } from "./local-watch-alert-state";
import { canonicalUrl, type NormalizedJob } from "./normalize";

export const LOCAL_WATCH_MAX_POSTING_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const LEDGER_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

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

async function githubRequest(ownerRepo: string, token: string, path: string, init: RequestInit = {}): Promise<Response> {
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

interface RemoteLedgerSnapshot {
  ledger: AlertLedger;
  sha: string | null;
}

async function loadRemoteSharedAlertLedger(ownerRepo: string, token: string): Promise<RemoteLedgerSnapshot> {
  const response = await githubRequest(ownerRepo, token, "/contents/board/alerted.json?ref=main");
  if (response.status === 404) return { ledger: {}, sha: null };
  if (!response.ok) throw new Error(`GitHub shared alert-ledger lookup failed: ${response.status}`);
  const payload = (await response.json()) as { content?: string; encoding?: string; sha?: string };
  if (payload.encoding !== "base64" || !payload.content) throw new Error("GitHub returned an unreadable shared alert ledger");
  try {
    return {
      ledger: JSON.parse(Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8")) as AlertLedger,
      sha: payload.sha ?? null,
    };
  } catch {
    throw new Error("GitHub returned invalid JSON for the shared alert ledger");
  }
}

/** Recover local-watch history from GitHub itself if the gitignored local state is lost. */
async function loadLocalWatchIssueLedger(ownerRepo: string, token: string): Promise<AlertLedger> {
  const ledger: AlertLedger = {};
  for (let page = 1; page <= 5; page += 1) {
    const response = await githubRequest(
      ownerRepo,
      token,
      `/issues?state=all&labels=${encodeURIComponent("local-watch")}&per_page=100&page=${page}`,
    );
    if (!response.ok) throw new Error(`GitHub local-watch issue lookup failed: ${response.status}`);
    const issues = (await response.json()) as { body?: string | null; created_at?: string }[];
    for (const issue of issues) {
      for (const match of (issue.body ?? "").matchAll(/\[Apply\]\((https?:\/\/[^)]+)\)/g)) {
        ledger[canonicalUrl(match[1])] = issue.created_at ?? new Date().toISOString();
      }
    }
    if (issues.length < 100) break;
  }
  return ledger;
}

async function syncRemoteSharedAlertLedger(ownerRepo: string, token: string, additions: AlertLedger): Promise<void> {
  if (Object.keys(additions).length === 0) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await loadRemoteSharedAlertLedger(ownerRepo, token);
    const merged = { ...additions, ...current.ledger };
    const changed = Object.keys(additions).some((url) => !(url in current.ledger));
    if (!changed) return;
    const response = await githubRequest(ownerRepo, token, "/contents/board/alerted.json", {
      method: "PUT",
      body: JSON.stringify({
        message: "chore: record local-watch alerts [skip ci]",
        content: Buffer.from(`${JSON.stringify(merged, null, 1)}\n`, "utf8").toString("base64"),
        sha: current.sha ?? undefined,
        branch: "main",
      }),
    });
    if (response.ok) return;
    if (response.status === 409 || response.status === 422) continue;
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub shared alert-ledger update failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  throw new Error("GitHub shared alert-ledger update conflicted three times");
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

function normalizedIdentityPart(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Stable fallback identity when the same role arrives through different provider URLs. */
export function localWatchSemanticKey(job: BoardJob): string {
  const identity = [job.company, job.title, job.location, job.season, job.roleType].map(normalizedIdentityPart).join("|");
  return `semantic:${createHash("sha1").update(identity).digest("hex")}`;
}

/** Two calendar days for date-only sources; exactly 48 hours for timestamped sources. */
export function isLocalWatchRecentEnough(job: BoardJob, nowMs: number): boolean {
  if (!job.postedAt) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(job.postedAt)) {
    const postedDay = Date.parse(`${job.postedAt}T00:00:00Z`);
    const now = new Date(nowMs);
    const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Number.isFinite(postedDay) && currentDay - postedDay <= LOCAL_WATCH_MAX_POSTING_AGE_MS;
  }
  const posted = new Date(job.postedAt).getTime();
  return Number.isFinite(posted) && nowMs - posted <= LOCAL_WATCH_MAX_POSTING_AGE_MS;
}

function pruneLedger(ledger: AlertLedger, nowMs: number): AlertLedger {
  const cutoff = nowMs - LEDGER_RETENTION_MS;
  return Object.fromEntries(Object.entries(ledger).filter(([, at]) => {
    const time = new Date(at).getTime();
    return Number.isFinite(time) && time >= cutoff;
  }));
}

export function dedupeLocalWatchJobs(jobs: BoardJob[]): BoardJob[] {
  const byUrl = new Map<string, BoardJob>();
  for (const job of jobs) if (!byUrl.has(canonicalUrl(job.url))) byUrl.set(canonicalUrl(job.url), job);
  const byMeaning = new Map<string, BoardJob>();
  for (const job of byUrl.values()) if (!byMeaning.has(localWatchSemanticKey(job))) byMeaning.set(localWatchSemanticKey(job), job);
  return [...byMeaning.values()];
}

export function mergePendingLocalWatchJobs(
  state: LocalWatchAlertState,
  jobs: BoardJob[],
  newJobKeys: string[],
  now: string = new Date().toISOString(),
  sharedAlerted: AlertLedger = {},
): LocalWatchAlertState {
  const newKeys = new Set(newJobKeys);
  const candidates = [...state.pending];
  for (const job of jobs) {
    if (newKeys.has(job.dedupeKey)) candidates.push(job);
  }
  const nowMs = new Date(now).getTime();
  const semanticAlerted = state.semanticAlerted ?? {};
  const urlLedger = { ...sharedAlerted, ...state.alerted };
  const pending = dedupeLocalWatchJobs(candidates)
    .filter((job) => isLocalWatchRecentEnough(job, nowMs))
    .filter((job) => !(canonicalUrl(job.url) in urlLedger))
    .filter((job) => !(localWatchSemanticKey(job) in semanticAlerted));
  return {
    initialized: state.initialized,
    alerted: pruneLedger(state.alerted, nowMs),
    semanticAlerted: pruneLedger(semanticAlerted, nowMs),
    pending,
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
      for (const job of boardJobs) state.semanticAlerted[localWatchSemanticKey(job)] = now;
    }
    state.initialized = true;
  }
  state = mergePendingLocalWatchJobs(state, boardJobs, newJobKeys, now);
  // Save before any credential or network operation: failures remain retryable.
  saveLocalWatchAlertState(state);

  if (state.pending.length === 0) {
    return { notified: false, reason: "no new eligible opportunities" };
  }

  const ownerRepo = getOwnerRepo();
  if (!ownerRepo) return { notified: false, reason: "couldn't resolve the origin remote's owner/repo" };
  const token = getGitHubToken();
  if (!token) return { notified: false, reason: "no GitHub credential available via `git credential fill`" };

  // Use the same committed URL ledger as CI's urgent/big-tech streams, and
  // recover successful local alerts from their issue bodies. Backfilling
  // local issue history into the shared ledger prevents either stream from
  // notifying the same posting after the other one already did.
  const remoteLedger = (await loadRemoteSharedAlertLedger(ownerRepo, token)).ledger;
  const issueLedger = await loadLocalWatchIssueLedger(ownerRepo, token);
  await syncRemoteSharedAlertLedger(ownerRepo, token, issueLedger);
  state = mergePendingLocalWatchJobs(state, [], [], now, { ...remoteLedger, ...issueLedger });
  saveLocalWatchAlertState(state);

  const unalerted = state.pending;
  if (unalerted.length === 0) {
    return { notified: false, reason: "already alerted by local-watch, urgent, or big-tech" };
  }

  const title =
    unalerted.length === 1
      ? `🔔 Local watch: ${unalerted[0].company} — ${unalerted[0].title}`.replace(/[\r\n]/g, " ").slice(0, 150)
      : `🔔 Local watch: ${unalerted.length} new opportunities`;
  const fingerprint = createHash("sha256")
    .update(unalerted.map((job) => canonicalUrl(job.url)).sort().join("\n"))
    .digest("hex")
    .slice(0, 24);
  const body = `<!-- local-watch:${fingerprint} -->\ncc @${ownerRepo.split("/")[0]} — new eligible opportunities posted within the last 2 days from the local dashboard scan of supported API adapters and community job repositories.\n\n${renderNewJobsAlertTable(unalerted, now)}`;

  await createGitHubIssue(ownerRepo, token, title, body);
  state.alerted = recordAlerted(state.alerted, unalerted, now);
  for (const job of unalerted) state.semanticAlerted[localWatchSemanticKey(job)] = now;
  state.pending = [];
  saveLocalWatchAlertState(state);
  try {
    await syncRemoteSharedAlertLedger(ownerRepo, token, Object.fromEntries(unalerted.map((job) => [canonicalUrl(job.url), now])));
    return { notified: true, issueJobCount: unalerted.length };
  } catch (error) {
    // The issue is already real and local state is committed. Its body is a
    // recovery source, so the next scan will retry the shared-ledger backfill.
    return {
      notified: true,
      issueJobCount: unalerted.length,
      reason: `issue created; shared dedupe ledger will retry (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}
