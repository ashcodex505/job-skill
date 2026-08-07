import { createHash } from "node:crypto";
import { skillMatch, stripHtml, type CareerConfig } from "@/lib/career/config";
import { classifyTitle, isUsRemoteOrHybridLocation, type Classification, type ScoreBreakdown } from "./classify";

/** Whole-feed community sources (vs per-company ATS adapters). */
export const FEED_SOURCES = new Set(["simplifyjobs", "speedyapply", "vansh"]);

export interface RawJob {
  source:
    | "greenhouse"
    | "lever"
    | "ashby"
    | "workday"
    | "smartrecruiters"
    | "workable"
    | "amazon"
    | "atlassian"
    | "eightfold"
    | "bamboohr"
    | "recruitee"
    | "breezy"
    | "rippling"
    | "personio"
    | "pinpoint"
    | "shopify"
    | "jibeapply"
    | "oraclecloud"
    | "simplifyjobs"
    | "speedyapply"
    | "vansh"
    | "reverse-discovery"
    | "browser"
    | "career-ops";
  sourceId: string | null;
  company: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: string | null;
  /** Job description (HTML or plaintext) when the ATS API provides it. */
  description?: string | null;
  /**
   * Feed-supplied season signal (e.g. SimplifyJobs/vansh listings' own
   * `terms` field), used only when the title itself states no season —
   * see classify.ts's detectSeason(). Never overrides a season stated in
   * the title.
   */
  seasonHint?: string | null;
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

export type NormalizationRejectionReason =
  | "empty_title"
  | "irrelevant_title"
  | "non_us_location"
  | "internship_missing_season_or_role"
  | "internship_season_not_allowed"
  | "summer_company_not_approved"
  | "not_explicit_new_grad"
  | "missing_required_new_grad_phrase"
  | "new_grad_season_not_allowed"
  | "graduation_window_expired"
  | "stale_posting";

export interface NormalizationExplanation {
  job: NormalizedJob | null;
  reason: NormalizationRejectionReason | null;
  classification: Classification | null;
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
 * Graduation-date ranges describe applicant eligibility, not the posting's
 * recruiting season. Reject them only after the latest stated term has
 * ended: Winter=Feb, Spring=May, Summer=Jul, Fall/Autumn=Dec.
 */
export function isGraduationEligibilityExpired(title: string, ref: Date): boolean {
  if (!/\bgraduation date\b/i.test(title)) return false;
  const matches = [...title.matchAll(/\b(spring|summer|fall|autumn|winter)\s*[' ]?(20\d{2}|\d{2})\b/gi)];
  if (matches.length === 0) return false;
  const endTimes = matches.map((match) => {
    const term = match[1].toLowerCase();
    const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
    if (term === "winter") return Date.UTC(year, 2, 0, 23, 59, 59, 999);
    if (term === "spring") return Date.UTC(year, 5, 0, 23, 59, 59, 999);
    if (term === "summer") return Date.UTC(year, 7, 0, 23, 59, 59, 999);
    return Date.UTC(year, 11, 31, 23, 59, 59, 999);
  });
  return ref.getTime() > Math.max(...endTimes);
}

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
  return careerPolicyRejectionReason(raw, classification, config) === null;
}

export function careerPolicyRejectionReason(
  raw: Pick<RawJob, "company" | "title">,
  classification: Classification,
  config: CareerConfig,
): NormalizationRejectionReason | null {
  const { roleType, season, breakdown } = classification;

  if (roleType === "internship" && config.internshipSeasons.length > 0) {
    if (breakdown.role === 0 || !season) return "internship_missing_season_or_role";

    // A bare cycle year ("2027" — Amazon's own title convention, no season
    // word) is under-specified but not "missing": accept it if the year
    // matches any configured target season, since we can't tell which
    // season within that year it is. Only a title with an explicit season
    // word is held to the exact-season match (and the Summer 2027 company
    // gate below) — this mirrors how a missing/generic year already isn't
    // held against new-grad titles.
    const isBareYear = /^\d{4}$/.test(season);
    if (isBareYear) {
      const targetYears = config.internshipSeasons.map((target) => target.match(/\d{4}/)?.[0]).filter(Boolean);
      if (!targetYears.includes(season)) return "internship_season_not_allowed";
      return null;
    }

    if (!config.internshipSeasons.some((target) => equalsIgnoreCase(target, season))) {
      return "internship_season_not_allowed";
    }

    if (
      equalsIgnoreCase(season, "Summer 2027") &&
      config.summer2027ApprovedCompanies.length > 0 &&
      !isApprovedCompany(raw.company, config.summer2027ApprovedCompanies)
    ) {
      return "summer_company_not_approved";
    }
    return null;
  }

  if (config.requiredNewGradTitleKeywords.length > 0) {
    // In strict mode, generic full-time SWE roles are not assumed to be
    // entry-level merely because the title omits "Senior".
    if (roleType !== "new_grad" || breakdown.role === 0) return "not_explicit_new_grad";
    if (!config.requiredNewGradTitleKeywords.some((keyword) => includesPhrase(raw.title, keyword))) {
      return "missing_required_new_grad_phrase";
    }

    // A listing with no year is still useful; if it states a cycle, it must
    // match one of the configured New Grad seasons.
    const newGradSeasons = config.seasons.filter((target) => /new grad/i.test(target));
    if (season && newGradSeasons.length > 0 && !newGradSeasons.some((target) => equalsIgnoreCase(target, season))) {
      return "new_grad_season_not_allowed";
    }
  }

  return null;
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
  return explainNormalization(raw, config, ref).job;
}

/** Explain exactly why a posting was kept or rejected. */
export function explainNormalization(raw: RawJob, config?: CareerConfig, ref: Date = new Date()): NormalizationExplanation {
  const title = raw.title.trim().replace(/\s+/g, " ");
  if (!title) return { job: null, reason: "empty_title", classification: null };
  // browser-sourced jobs (source: "browser") have no structured location
  // field — the generic DOM extractor glues it into the title text instead
  // ("Software Engineer Intern United States, Washington, Redmond") — so
  // the US-only hard filter below must check the title for these, or it's
  // silently inert for every browser-scanned company (confirmed live: a
  // Berlin posting passed straight through with raw.location === null).
  const locationSignal = raw.location ?? (raw.source === "browser" ? title : null);
  const classification = classifyTitle(title, locationSignal, config, ref, raw.seasonHint);
  const { relevant, roleType, season, score, breakdown } = classification;
  if (!relevant) return { job: null, reason: "irrelevant_title", classification };
  // Hard location policy: US, remote, or hybrid only — not a scoring signal.
  if (!isUsRemoteOrHybridLocation(locationSignal)) return { job: null, reason: "non_us_location", classification };
  if (config && isGraduationEligibilityExpired(title, ref)) {
    return { job: null, reason: "graduation_window_expired", classification };
  }
  if (config) {
    const reason = careerPolicyRejectionReason({ company: raw.company, title }, classification, config);
    if (reason) return { job: null, reason, classification };
  }
  // Opt-in freshness gate (career/preferences.md "Max posting age (days)").
  // A posting with no known postedAt is never dropped by this — same
  // "don't penalize missing data" rule as every other filter in this file.
  if (config?.maxPostingAgeDays && raw.postedAt) {
    const postedMs = new Date(raw.postedAt).getTime();
    if (Number.isFinite(postedMs) && ref.getTime() - postedMs > config.maxPostingAgeDays * 86_400_000) {
      return { job: null, reason: "stale_posting", classification };
    }
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
    reason: null,
    classification,
    job: {
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
    },
  };
}

/**
 * Canonical form of a posting URL for cross-source duplicate detection.
 * The same job arrives with cosmetic URL differences: Workday paths vary in
 * case between the API and community feeds (NVIDIAExternalCareerSite vs
 * nvidiaexternalcareersite), and feeds append ?utm_source=… tracking.
 */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    let pathname = u.pathname.replace(/\/+$/, "");
    // Ashby exposes the same posting at both /<uuid> and
    // /<uuid>/application?embed=true. Treat those as one identity so feed
    // and direct-adapter copies cannot create duplicate issues.
    if (u.hostname.toLowerCase() === "jobs.ashbyhq.com") pathname = pathname.replace(/\/application$/i, "");
    // Workday exposes one requisition through multiple tenant boards and
    // locale-prefixed paths. The stable requisition suffix is the shared
    // identity (for example JR355250, R55736), while a trailing -1/-3 is a
    // cosmetic route variant rather than a different job.
    if (u.hostname.toLowerCase().endsWith(".myworkdayjobs.com")) {
      const requisition = pathname.match(/(?:_|-)([a-z]{1,4}\d{4,})(?:-\d+)?$/i)?.[1];
      if (requisition) pathname = `/requisition/${requisition}`;
    }
    return `${u.host}${pathname}`.toLowerCase().replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

const earliestDate = (a: string | null, b: string | null): string | null => {
  if (!a || !b) return a ?? b;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
};

/**
 * Removes intra-batch duplicates: same dedupeKey (same provider job seen
 * twice), then same canonical URL across sources — the community feeds
 * (SimplifyJobs, speedyapply) often list postings our company adapters also
 * fetch. The adapter copy wins (it carries descriptions/skill matches), but
 * the surviving copy inherits the EARLIEST posted date known by any
 * duplicate, so a source without dates (Workday) or a feed that only just
 * indexed an old job can never make a posting look newer than it is.
 */
export function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const byKey = new Map<string, NormalizedJob>();
  for (const job of jobs) {
    const existing = byKey.get(job.dedupeKey);
    if (!existing || job.score > existing.score) byKey.set(job.dedupeKey, job);
  }
  const byUrl = new Map<string, NormalizedJob>();
  for (const job of byKey.values()) {
    const url = canonicalUrl(job.url);
    const existing = byUrl.get(url);
    if (!existing) {
      byUrl.set(url, job);
      continue;
    }
    const winner = FEED_SOURCES.has(existing.source) && !FEED_SOURCES.has(job.source) ? job : existing;
    byUrl.set(url, { ...winner, postedAt: earliestDate(existing.postedAt, job.postedAt) });
  }
  return [...byUrl.values()];
}
