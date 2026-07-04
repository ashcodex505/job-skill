import { createHash } from "node:crypto";
import { classifyTitle, type Classification } from "./classify";

export interface RawJob {
  source: "greenhouse" | "lever" | "ashby" | "workday";
  sourceId: string | null;
  company: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: string | null;
}

export interface NormalizedJob extends RawJob {
  dedupeKey: string;
  roleType: Classification["roleType"];
  season: string | null;
  score: number;
}

/**
 * Stable dedupe key: prefer the provider's job id, fall back to the URL,
 * then to a content hash of company|title|location.
 */
export function makeDedupeKey(job: RawJob): string {
  if (job.sourceId) return `${job.source}:${job.sourceId}`;
  const basis = job.url || `${job.company}|${job.title}|${job.location ?? ""}`.toLowerCase();
  return `${job.source}:sha1:${createHash("sha1").update(basis).digest("hex")}`;
}

/** Classify, score, and key a raw job; returns null for irrelevant postings. */
export function normalizeJob(raw: RawJob): NormalizedJob | null {
  const title = raw.title.trim().replace(/\s+/g, " ");
  if (!title) return null;
  const { relevant, roleType, season, score } = classifyTitle(title, raw.location);
  if (!relevant) return null;
  return {
    ...raw,
    title,
    location: raw.location?.trim() || null,
    dedupeKey: makeDedupeKey(raw),
    roleType,
    season,
    score,
  };
}

/** Removes intra-batch duplicates (same job appearing twice in one scrape). */
export function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const seen = new Map<string, NormalizedJob>();
  for (const job of jobs) {
    const existing = seen.get(job.dedupeKey);
    if (!existing || job.score > existing.score) seen.set(job.dedupeKey, job);
  }
  return [...seen.values()];
}
