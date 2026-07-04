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

export interface Classification {
  relevant: boolean;
  roleType: RoleType;
  season: string | null;
  /** 0–100 relevance for a SWE new-grad / Summer-2027-intern search. */
  score: number;
}

export function classifyTitle(title: string, location?: string | null): Classification {
  const roleType = detectRoleType(title);
  const season = detectSeason(title);
  const isRole = matchesAny(ROLE_KEYWORDS, title);
  const isEarlyCareer = roleType !== "unknown";
  const senior = isSeniorRole(title);

  // Senior/staff/etc. is disqualifying unless the title is explicitly early-career.
  if (senior && !isEarlyCareer) return { relevant: false, roleType, season, score: 0 };
  // Must look like an engineering role or be an explicitly early-career SWE-ish posting.
  if (!isRole && !isEarlyCareer) return { relevant: false, roleType, season, score: 0 };

  let score = 0;
  if (isRole) score += 40;
  if (roleType === "internship") score += 30;
  if (roleType === "new_grad") score += 30;
  if (season) {
    score += 10;
    if (/summer 2027/i.test(season)) score += 15;
    if (/(fall 2026|2027 new grad|spring 2027)/i.test(season)) score += 10;
  }
  if (location && /(remote|arizona|\baz\b|tempe|phoenix|scottsdale|chandler)/i.test(location)) score += 5;
  // Early-career-only titles without a clear SWE keyword ("2027 New Grad Program") stay relevant but score low.
  if (!isRole) score = Math.min(score, 35);

  return { relevant: score >= 30, roleType, season, score: Math.min(score, 100) };
}
