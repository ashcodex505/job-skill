import { createHash } from "node:crypto";
import { skillMatch, stripHtml, type CareerConfig } from "@/lib/career/config";
import { classifyTitle, type Classification, type ScoreBreakdown } from "./classify";

/** Whole-feed community sources (vs per-company ATS adapters). */
export const FEED_SOURCES = new Set(["simplifyjobs", "speedyapply"]);

export interface RawJob {
  source: "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters" | "workable" | "simplifyjobs" | "speedyapply";
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

const normalizedWords = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

const includesPhrase = (text: string, phrase: string): boolean => {
  const needle = normalizedWords(phrase);
  return Boolean(needle && ` ${normalizedWords(text)} `.includes(` ${needle} `));
};

const equalsIgnoreCase = (left: string, right: string): boolean =>
  normalizedWords(left) === normalizedWords(right);

/**
 * Company names vary slightly by source (for example, "Meta" vs.
 * "Meta Platforms"). Match exact normalized names plus a whole-word prefix,
 * while avoiding broad substring matches such as "AI" inside another name.
 */
export function isApprovedCompany(company: string, approvedCompanies: string[]): boolean {
  const candidate = normalizedWords(company);
  if (!candidate) return false;
  return approvedCompanies.some((approved) => {
    const allowed = normalizedWords(approved);
    if (!allowed) return false;
    return candidate === allowed || candidate.startsWith(`${allowed} `) || allowed.startsWith(`${candidate} `);
  });
}

/**
 * Apply the hard constraints from career/preferences.md after title
 * classification. Empty policy sections preserve the legacy score-only
 * behavior, so older preference files remain valid.
 */
export function passesCareerPolicy(
  raw: Pick<RawJob, "company" | "title">,
  classification: Classification,
  config: CareerConfig,
): boolean {
  const { roleType, season, breakdown } = classification;

  if (roleType === "internship" && config.internshipSeasons.length > 0) {
    if (breakdown.role === 0 || !season) return false;
    if (!config.internshipSeasons.some((target) => equalsIgnoreCase(target, season))) return false;

    if (
      equalsIgnoreCase(season, "Summer 2027") &&
      config.summer2027ApprovedCompanies.length > 0 &&
      !isApprovedCompany(raw.company, config.summer2027ApprovedCompanies)
    ) {
      return false;
    }
    return true;
  }

  if (config.requiredNewGradTitleKeywords.length > 0) {
    // In strict mode, generic full-time SWE roles are not assumed to be
    // entry-level merely because the title omits "Senior".
    if (roleType !== "new_grad" || breakdown.role === 0) return false;
    if (!config.requiredNewGradTitleKeywords.some((keyword) => includesPhrase(raw.title, keyword))) return false;

    // A listing with no year is still useful; if it states a cycle, it must
    // match one of the configured New Grad seasons.
    const newGradSeasons = config.seasons.filter((target) => /new grad/i.test(target));
    if (season && newGradSeasons.length > 0 && !newGradSeasons.some((target) => equalsIgnoreCase(target, season))) {
      return false;
    }
  }

  return true;
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
  if (config && !passesCareerPolicy({ company: raw.company, title }, { relevant, roleType, season, score, breakdown }, config)) {
    return null;
  }

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

/**
 * Removes intra-batch duplicates: same dedupeKey (same provider job seen
 * twice), then same exact URL across sources — the community feeds
 * (SimplifyJobs, speedyapply) often list postings our company adapters also
 * fetch; the adapter copy wins (it carries descriptions/skill matches), and
 * between two feeds the earlier-processed one wins deterministically.
 */
export function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const byKey = new Map<string, NormalizedJob>();
  for (const job of jobs) {
    const existing = byKey.get(job.dedupeKey);
    if (!existing || job.score > existing.score) byKey.set(job.dedupeKey, job);
  }
  const byUrl = new Map<string, NormalizedJob>();
  for (const job of byKey.values()) {
    const url = job.url.replace(/\/+$/, "");
    const existing = byUrl.get(url);
    if (!existing || (FEED_SOURCES.has(existing.source) && !FEED_SOURCES.has(job.source))) {
      byUrl.set(url, job);
    }
  }
  return [...byUrl.values()];
}
