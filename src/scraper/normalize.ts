import { createHash } from "node:crypto";
import { skillMatch, stripHtml, type CareerConfig } from "@/lib/career/config";
import { classifyTitle, type Classification, type ScoreBreakdown } from "./classify";

export interface RawJob {
  source: "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters" | "workable";
  sourceId: string | null;
  company: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: string | null;
  /** Job description (HTML or plaintext) when the ATS API provides it. */
  description?: string | null;
}

/** Descriptions are stored for saved jobs but capped to keep rows sane. */
const DESCRIPTION_MAX_CHARS = 10_000;

export interface NormalizedJob extends Omit<RawJob, "description"> {
  dedupeKey: string;
  roleType: Classification["roleType"];
  season: string | null;
  score: number;
  breakdown: ScoreBreakdown;
  /** Skills from career/profile.md found in the posting. */
  matchedSkills: string[];
  /** Plaintext job description (HTML stripped, length-capped) or null. */
  descriptionText: string | null;
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
export function normalizeJob(raw: RawJob, config?: CareerConfig, ref: Date = new Date()): NormalizedJob | null {
  const title = raw.title.trim().replace(/\s+/g, " ");
  if (!title) return null;
  const { relevant, roleType, season, score, breakdown } = classifyTitle(title, raw.location, config, ref);
  if (!relevant) return null;

  const descriptionText = raw.description ? stripHtml(raw.description).slice(0, DESCRIPTION_MAX_CHARS) || null : null;

  let skillsScore = 0;
  let matchedSkills: string[] = [];
  if (config?.skills.length) {
    const match = skillMatch(config.skills, `${title} ${descriptionText ?? ""}`);
    matchedSkills = match.matched;
    skillsScore = Math.round(match.ratio * 25);
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
    score: Math.min(100, score + skillsScore),
    breakdown: { ...breakdown, skills: skillsScore },
    matchedSkills,
    descriptionText,
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
