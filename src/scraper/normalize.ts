import { createHash } from "node:crypto";
import { skillMatch, stripHtml, type CareerConfig } from "@/lib/career/config";
import { classifyTitle, type Classification } from "./classify";

export interface RawJob {
  source: "greenhouse" | "lever" | "ashby" | "workday";
  sourceId: string | null;
  company: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: string | null;
  /** Job description (HTML or plaintext) when the ATS API provides it. */
  description?: string | null;
}

export interface NormalizedJob extends Omit<RawJob, "description"> {
  dedupeKey: string;
  roleType: Classification["roleType"];
  season: string | null;
  score: number;
  /** Skills from career/profile.md found in the posting. */
  matchedSkills: string[];
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

/**
 * Classify, score, and key a raw job; returns null for irrelevant postings.
 * With a career config (career/*.md), the title filter uses your preferences
 * and the score gets a skill-match boost (up to +25) based on how many of
 * your profile skills appear in the posting's title + description.
 */
export function normalizeJob(raw: RawJob, config?: CareerConfig): NormalizedJob | null {
  const title = raw.title.trim().replace(/\s+/g, " ");
  if (!title) return null;
  const { relevant, roleType, season, score } = classifyTitle(title, raw.location, config);
  if (!relevant) return null;

  let finalScore = score;
  let matchedSkills: string[] = [];
  if (config?.skills.length) {
    const text = `${title} ${raw.description ? stripHtml(raw.description) : ""}`;
    const match = skillMatch(config.skills, text);
    matchedSkills = match.matched;
    finalScore = Math.min(100, score + Math.round(match.ratio * 25));
  }

  const { description: _description, ...rest } = raw;
  void _description;
  return {
    ...rest,
    title,
    location: raw.location?.trim() || null,
    dedupeKey: makeDedupeKey(raw),
    roleType,
    season,
    score: finalScore,
    matchedSkills,
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
