import fs from "node:fs";
import path from "node:path";
import type { NormalizedJob } from "./normalize";

export const GOOGLE_APPLICATION_POLL_MS = 10 * 60_000;
const UNAVAILABLE_CONFIRMATIONS = 3;
const GOOGLE_JOB_URL_RE = /^https:\/\/(?:www\.)?google\.com\/about\/careers\/applications\/jobs\/results\/(\d+)(?:[-/?#]|$)/i;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type GoogleApplicationStatus = "waiting_for_apply" | "application_open" | "unavailable";

export interface GoogleApplicationWatchEntry {
  jobId: string;
  url: string;
  title: string;
  location: string | null;
  status: GoogleApplicationStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCheckedAt: string | null;
  applyDetectedAt: string | null;
  notifiedAt: string | null;
  consecutiveUnavailableChecks: number;
  consecutiveFailures: number;
  lastError: string | null;
  manuallyWatched: boolean;
  job: NormalizedJob;
}

export interface GoogleApplicationWatchState {
  version: 1;
  entries: Record<string, GoogleApplicationWatchEntry>;
}

export type GoogleApplicationProbe =
  | { kind: "available"; applicationOpen: boolean; title: string | null }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

function statePath(): string {
  return process.env.GOOGLE_APPLICATION_WATCH_STATE_PATH ?? path.join(process.cwd(), "data", "google-application-watch.json");
}

function emptyState(): GoogleApplicationWatchState {
  return { version: 1, entries: {} };
}

export function loadGoogleApplicationWatchState(): GoogleApplicationWatchState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8")) as GoogleApplicationWatchState;
    return parsed?.version === 1 && parsed.entries && typeof parsed.entries === "object" ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

function saveGoogleApplicationWatchState(state: GoogleApplicationWatchState): void {
  const destination = statePath();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, destination);
}

export function googleJobIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const canonical = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    return canonical.match(GOOGLE_JOB_URL_RE)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function canonicalGoogleJobUrl(url: string): string | null {
  const id = googleJobIdFromUrl(url);
  return id ? `https://www.google.com/about/careers/applications/jobs/results/${id}` : null;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " " };
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name: string) => named[name.toLowerCase()] ?? all)
    .replace(/\s+/g, " ")
    .trim();
}

export function googleApplicationIsOpen(html: string): boolean {
  return [...html.matchAll(/<a\b[^>]*>/gi)].some((match) => {
    const tag = match[0];
    const aria = tag.match(/\baria-label\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    const href = tag.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    return /^apply$/i.test(decodeHtml(aria)) && /(?:^|\/)apply\?[^"']*\bjobId=/i.test(decodeHtml(href));
  });
}

export function googleJobTitleFromHtml(html: string): string | null {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (!raw) return null;
  const title = decodeHtml(raw.replace(/<[^>]+>/g, "")).replace(/\s*[—|-]\s*Google Careers.*$/i, "").trim();
  return title || null;
}

export async function probeGoogleApplication(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleApplicationProbe> {
  const expectedId = googleJobIdFromUrl(url);
  if (!expectedId) return { kind: "error", message: "not a valid Google Careers job URL" };

  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (response.status === 404 || response.status === 410) {
      return { kind: "unavailable", reason: `Google returned HTTP ${response.status}` };
    }
    if (!response.ok) return { kind: "error", message: `Google returned HTTP ${response.status}` };

    const html = await response.text();
    if (/unusual traffic|are you a robot|captcha|access denied|request blocked/i.test(html.slice(0, 50_000))) {
      return { kind: "error", message: "Google returned a challenge or block page" };
    }
    const finalId = response.url ? googleJobIdFromUrl(response.url) : expectedId;
    const title = googleJobTitleFromHtml(html);
    if ((finalId && finalId !== expectedId) || !title) {
      return { kind: "unavailable", reason: "Google no longer returned the requested job detail page" };
    }
    return { kind: "available", applicationOpen: googleApplicationIsOpen(html), title };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function applyGoogleApplicationProbe(
  entry: GoogleApplicationWatchEntry,
  probe: GoogleApplicationProbe,
  checkedAt: string,
): GoogleApplicationWatchEntry {
  if (probe.kind === "error") {
    return {
      ...entry,
      lastCheckedAt: checkedAt,
      consecutiveFailures: entry.consecutiveFailures + 1,
      lastError: probe.message,
    };
  }
  if (probe.kind === "unavailable") {
    const confirmations = entry.consecutiveUnavailableChecks + 1;
    return {
      ...entry,
      status: confirmations >= UNAVAILABLE_CONFIRMATIONS ? "unavailable" : entry.status,
      lastCheckedAt: checkedAt,
      consecutiveUnavailableChecks: confirmations,
      consecutiveFailures: 0,
      lastError: probe.reason,
    };
  }

  const opened = probe.applicationOpen;
  return {
    ...entry,
    title: probe.title ?? entry.title,
    job: probe.title ? { ...entry.job, title: probe.title } : entry.job,
    status: opened ? "application_open" : "waiting_for_apply",
    lastCheckedAt: checkedAt,
    applyDetectedAt: opened ? entry.applyDetectedAt ?? checkedAt : null,
    consecutiveUnavailableChecks: 0,
    consecutiveFailures: 0,
    lastError: null,
  };
}

function newEntry(job: NormalizedJob, manuallyWatched: boolean, now: string): GoogleApplicationWatchEntry | null {
  const jobId = googleJobIdFromUrl(job.url);
  const url = canonicalGoogleJobUrl(job.url);
  if (!jobId || !url) return null;
  const canonicalJob = { ...job, url };
  return {
    jobId,
    url,
    title: job.title,
    location: job.location,
    status: "waiting_for_apply",
    firstSeenAt: now,
    lastSeenAt: now,
    lastCheckedAt: null,
    applyDetectedAt: null,
    notifiedAt: null,
    consecutiveUnavailableChecks: 0,
    consecutiveFailures: 0,
    lastError: null,
    manuallyWatched,
    job: canonicalJob,
  };
}

export function isGoogleApplicationCheckDue(entry: GoogleApplicationWatchEntry, nowMs: number): boolean {
  // Once Apply has been seen, notification retries use the persisted open
  // state; there is no value in continuing to poll that page forever.
  if (entry.status !== "waiting_for_apply") return false;
  if (!entry.lastCheckedAt) return true;
  const last = new Date(entry.lastCheckedAt).getTime();
  return !Number.isFinite(last) || nowMs - last >= GOOGLE_APPLICATION_POLL_MS;
}

const lockGlobal = globalThis as unknown as { __rtGoogleApplicationWatchQueue?: Promise<void> };

async function withStateLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = lockGlobal.__rtGoogleApplicationWatchQueue ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  lockGlobal.__rtGoogleApplicationWatchQueue = tail;
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (lockGlobal.__rtGoogleApplicationWatchQueue === tail) delete lockGlobal.__rtGoogleApplicationWatchQueue;
  }
}

export async function registerAndRefreshGoogleApplicationWatches(
  jobs: NormalizedJob[],
  options: {
    manuallyWatched?: boolean;
    force?: boolean;
    now?: Date;
    fetchImpl?: typeof fetch;
    initialProbes?: Record<string, GoogleApplicationProbe>;
  } = {},
): Promise<GoogleApplicationWatchState> {
  return withStateLock(async () => {
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const state = loadGoogleApplicationWatchState();
    for (const job of jobs) {
      const id = googleJobIdFromUrl(job.url);
      if (!id) continue;
      const existing = state.entries[id];
      if (!existing) {
        const entry = newEntry(job, options.manuallyWatched ?? false, nowIso);
        if (entry) state.entries[id] = entry;
      } else {
        state.entries[id] = {
          ...existing,
          title: job.title,
          location: job.location,
          lastSeenAt: nowIso,
          manuallyWatched: existing.manuallyWatched || (options.manuallyWatched ?? false),
          job: { ...job, url: existing.url },
        };
      }
    }

    for (const [id, entry] of Object.entries(state.entries)) {
      if (!options.force && !isGoogleApplicationCheckDue(entry, now.getTime())) continue;
      state.entries[id] = applyGoogleApplicationProbe(
        entry,
        options.initialProbes?.[id] ?? (await probeGoogleApplication(entry.url, options.fetchImpl ?? fetch)),
        nowIso,
      );
    }
    saveGoogleApplicationWatchState(state);
    return state;
  });
}

export async function refreshGoogleApplicationWatches(options: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<GoogleApplicationWatchState> {
  return registerAndRefreshGoogleApplicationWatches([], options);
}

export async function removeManualGoogleApplicationWatch(jobId: string): Promise<GoogleApplicationWatchState> {
  return withStateLock(async () => {
    const state = loadGoogleApplicationWatchState();
    if (state.entries[jobId]?.manuallyWatched) delete state.entries[jobId];
    saveGoogleApplicationWatchState(state);
    return state;
  });
}

export async function markGoogleApplicationsNotified(urls: string[], notifiedAt: string): Promise<void> {
  const ids = new Set(urls.map(googleJobIdFromUrl).filter((id): id is string => Boolean(id)));
  if (ids.size === 0) return;
  await withStateLock(async () => {
    const state = loadGoogleApplicationWatchState();
    for (const id of ids) {
      if (state.entries[id]) state.entries[id].notifiedAt = notifiedAt;
    }
    saveGoogleApplicationWatchState(state);
  });
}

export function openUnnotifiedGoogleJobs(state: GoogleApplicationWatchState): NormalizedJob[] {
  return Object.values(state.entries)
    .filter((entry) => entry.status === "application_open" && !entry.notifiedAt)
    .map((entry) => entry.job);
}
