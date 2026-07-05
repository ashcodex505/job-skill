import type { RoleType } from "@/lib/types";

/**
 * Title classification tuned from the career-ops portal filter config:
 * SWE-family roles, internship (Summer 2027 focus) and new-grad cycles,
 * with senior/staff/manager exclusion.
 */

const ROLE_KEYWORDS = [
  /software engineer/i,
  /software developer/i,
  /\bswe\b/i,
  /\bdeveloper\b/i,
  /back[- ]?end/i,
  /front[- ]?end/i,
  /full[- ]?stack/i,
  /infrastructure/i,
  /\bsystems?\b/i,
  /platform engineer/i,
  /\bml engineer\b/i,
  /machine learning engineer/i,
  /\bai engineer\b/i,
  /site reliability/i,
  /web developer/i,
  /applications engineer/i,
];

const INTERN_KEYWORDS = [/\bintern(ship)?\b/i, /\bco[- ]?op\b/i];

const NEW_GRAD_KEYWORDS = [
  /new grad(uate)?/i,
  /university grad(uate)?/i,
  /college grad(uate)?/i,
  /early[- ]career/i,
  /campus hire/i,
  /entry[- ]level/i,
  /grad(uate)? (software|engineer|program)/i,
  /\bemerging talent\b/i,
];

/** Disqualifying unless the title is clearly intern/new-grad anyway. */
const SENIOR_KEYWORDS = [
  /\bsenior\b/i,
  /\bsr\.?\s/i,
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\bdistinguished\b/i,
  /\blead\b/i,
  /\bmanager\b/i,
  /\bdirector\b/i,
  /\badministrator\b/i,
  /\bvp\b/i,
  /\bhead of\b/i,
  /\barchitect\b/i,
  /\b(l[5-9]|e[5-9]|ic[4-9])\b/i,
];

const SEASON_RE = /(spring|summer|fall|autumn|winter)\s*[' ]?(\d{4}|\d{2})\b/i;
const YEAR_RE = /\b(20\d{2})\b/;

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((re) => re.test(text));
}

export function detectRoleType(title: string): RoleType {
  if (matchesAny(INTERN_KEYWORDS, title)) return "internship";
  if (matchesAny(NEW_GRAD_KEYWORDS, title)) return "new_grad";
  return "unknown";
}

export function detectSeason(title: string): string | null {
  const m = title.match(SEASON_RE);
  if (m) {
    const term = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const year = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${term === "Autumn" ? "Fall" : term} ${year}`;
  }
  const year = title.match(YEAR_RE);
  if (year && detectRoleType(title) === "new_grad") return `${year[1]} New Grad`;
  return null;
}

export function isSeniorRole(title: string): boolean {
  return matchesAny(SENIOR_KEYWORDS, title);
}

/** Per-signal score components; `skills` is filled in by normalizeJob. */
export interface ScoreBreakdown {
  role: number;
  roleType: number;
  season: number;
  location: number;
  keywords: number;
  skills: number;
}

export interface Classification {
  relevant: boolean;
  roleType: RoleType;
  season: string | null;
  /** 0–100 relevance for a SWE early-career search (skills boost added later). */
  score: number;
  breakdown: Omit<ScoreBreakdown, "skills">;
}

/**
 * Target seasons derived from "today" instead of hardcoded years, so the
 * scraper stays useful next cycle without edits. Jan–Apr still targets the
 * current year's summer (those postings are open); from May on, the next one.
 * career/preferences.md Seasons overrides this entirely.
 */
export function defaultSeasonTargets(ref: Date): { strong: string[]; medium: string[] } {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth() + 1;
  const summerYear = m <= 4 ? y : y + 1;
  return {
    strong: [`Summer ${summerYear}`],
    medium: [
      `Fall ${m <= 8 ? y : y + 1}`,
      `Spring ${summerYear}`,
      `Winter ${summerYear}`,
      `${y} New Grad`,
      `${y + 1} New Grad`,
    ],
  };
}

/** career/preferences.md overrides/additions (see src/lib/career/config.ts). */
export interface ClassifyPrefs {
  targetRoles?: string[];
  seasons?: string[];
  locations?: string[];
  positiveKeywords?: string[];
  negativeKeywords?: string[];
}

const containsAny = (needles: string[] | undefined, text: string): boolean =>
  Boolean(needles?.some((n) => n.trim() && text.toLowerCase().includes(n.trim().toLowerCase())));

const NO_SCORE: Omit<ScoreBreakdown, "skills"> = { role: 0, roleType: 0, season: 0, location: 0, keywords: 0 };

export function classifyTitle(
  title: string,
  location?: string | null,
  prefs?: ClassifyPrefs,
  ref: Date = new Date(),
): Classification {
  const roleType = detectRoleType(title);
  const season = detectSeason(title);
  const isEarlyCareer = roleType !== "unknown";
  const senior = isSeniorRole(title);

  // User-defined hard exclusions (career/preferences.md → Negative title keywords).
  if (containsAny(prefs?.negativeKeywords, title)) {
    return { relevant: false, roleType, season, score: 0, breakdown: NO_SCORE };
  }
  // Senior/staff/etc. is disqualifying unless the title is explicitly early-career.
  if (senior && !isEarlyCareer) return { relevant: false, roleType, season, score: 0, breakdown: NO_SCORE };

  const isRole = matchesAny(ROLE_KEYWORDS, title) || containsAny(prefs?.targetRoles, title);
  // Must look like an engineering role or be an explicitly early-career SWE-ish posting.
  if (!isRole && !isEarlyCareer) return { relevant: false, roleType, season, score: 0, breakdown: NO_SCORE };

  let seasonScore = 0;
  if (season) {
    seasonScore += 10;
    if (prefs?.seasons?.length) {
      if (prefs.seasons.some((s) => s.trim().toLowerCase() === season.toLowerCase())) seasonScore += 15;
    } else {
      const targets = defaultSeasonTargets(ref);
      const match = (list: string[]) => list.some((s) => s.toLowerCase() === season.toLowerCase());
      if (match(targets.strong)) seasonScore += 15;
      else if (match(targets.medium)) seasonScore += 10;
    }
  }
  const locationPreferred = prefs?.locations?.length
    ? containsAny(prefs.locations, location ?? "")
    : Boolean(location && /(remote|arizona|\baz\b|tempe|phoenix|scottsdale|chandler)/i.test(location));

  const breakdown: Omit<ScoreBreakdown, "skills"> = {
    role: isRole ? 40 : 0,
    roleType: isEarlyCareer ? 30 : 0,
    season: seasonScore,
    location: locationPreferred ? 5 : 0,
    keywords: containsAny(prefs?.positiveKeywords, title) ? 10 : 0,
  };
  let score = breakdown.role + breakdown.roleType + breakdown.season + breakdown.location + breakdown.keywords;
  // Early-career-only titles without a clear SWE keyword ("2027 New Grad Program") stay relevant but score low.
  if (!isRole) score = Math.min(score, 35);

  return { relevant: score >= 30, roleType, season, score: Math.min(score, 100), breakdown };
}
