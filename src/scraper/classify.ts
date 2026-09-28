import type { RoleType } from "@/lib/types";

/**
 * Title classification tuned from the career-ops portal filter config:
 * SWE-family roles, internship (Summer 2027 focus) and new-grad cycles,
 * with senior/staff/manager exclusion.
 */

const ROLE_KEYWORDS = [
  /software engineer/i,
  /software developer/i,
  // Amazon's own title for the role ("SDE") — word order differs from both
  // patterns above ("Software Development Engineer" vs. "Software Engineer"/
  // "Software Developer") and was silently missed entirely, rejecting even
  // in-policy Amazon internships (right role, right season, right US
  // location) because the classifier scored them as a non-role posting.
  /software development engineer/i,
  /\bsde\b/i,
  /\bswe\b/i,
  /\bdeveloper\b/i,
  // A bare "Software" mention ("Vehicle Software Intern", "Software
  // Integration Engineer Intern") is a real signal even without the exact
  // "Software Engineer"/"Software Developer" phrase — same class of gap as
  // the Amazon SDE fix above (title uses different but legitimate wording).
  /\bsoftware\b/i,
  /back[- ]?end/i,
  /front[- ]?end/i,
  /full[- ]?stack/i,
  // Infrastructure and systems are only software signals with an engineering
  // qualifier. Bare matches admitted investment infrastructure, power
  // systems, systems marketing, mechanical systems, and similar roles.
  /\binfrastructure (?:software )?engineer/i,
  /\b(?:software|developer|production|cloud|data|ai|ml|inference|compute) infrastructure\b/i,
  /\b(?:ai|ml)\b.*\binfrastructure\b/i,
  /\bdistributed (?:systems?|computing)\b/i,
  /\bsystems? software\b/i,
  /\bsystems research engineer\b.*\b(?:gpu programming|distributed|inference|software)\b/i,
  /\binference\b/i,
  /\bmodel serving\b/i,
  /\b(?:ai|ml|machine learning|generative ai) research engineer\b/i,
  /\bresearch engineer\b.*\b(?:ai|ml|machine learning|software|distributed|inference)\b/i,
  /platform engineer/i,
  /\bml engineer\b/i,
  /machine learning engineer/i,
  /\bai engineer\b/i,
  /site reliability/i,
  /\bsre\b/i,
  /web developer/i,
  /applications engineer/i,
  // Customer-facing builders at AI labs and high-signal product companies.
  // Keep the acronym bounded: a plain target-role substring such as "FDE"
  // could otherwise match unrelated text inside a longer word.
  /\bforward[- ]deployed(?: (?:software|infrastructure|ai|ml|security|product))? engineer\b/i,
  /\b(?:ai )?deployment engineer\b/i,
  /\b(?:partner )?deployed engineer\b/i,
  /\bfde\b/i,
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
  /\bjunior\b/i,
  /\b(?:engineer|developer|swe|sde)[ -]+(?:i|1)\b/i,
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

/**
 * `hint` is a feed-supplied season string (e.g. SimplifyJobs/vansh listings'
 * own `terms` field) used only when the title itself states no season —
 * many real postings never restate the season in their title at all
 * ("Vehicle Software Intern - Vehicle Controls" says nothing about Fall
 * 2026, even though the feed that carried it knows exactly which cycle
 * it's for). The title is still authoritative when it does state one:
 * a hint is never allowed to override text actually present in the title.
 */
export function detectSeason(title: string, hint?: string | null): string | null {
  const roleType = detectRoleType(title);
  // A new-grad title may state an eligibility window such as "Graduation
  // Date: Fall 2025-Summer 2026". That describes who may apply, not the
  // recruiting cycle of the posting, so it must not be compared with target
  // seasons such as "2027 New Grad".
  if (roleType === "new_grad" && /\bgraduation date\b/i.test(title)) return null;
  const m = title.match(SEASON_RE);
  if (m) {
    const term = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const year = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${term === "Autumn" ? "Fall" : term} ${year}`;
  }
  const year = title.match(YEAR_RE);
  if (year) {
    if (roleType === "new_grad") return `${year[1]} New Grad`;
    // Internship titles often state only a bare cycle year with no season word
    // ("2027 Software Dev Engineer Intern" — Amazon's own convention). That's
    // a real (if under-specified) season signal, not a missing one — return
    // the bare year so passesCareerPolicy can match it against a configured
    // season's year instead of hard-excluding it as unstated.
    if (roleType === "internship") return year[1];
  }
  if (hint) {
    const hintMatch = hint.match(SEASON_RE);
    if (hintMatch) {
      const term = hintMatch[1][0].toUpperCase() + hintMatch[1].slice(1).toLowerCase();
      const year = hintMatch[2].length === 2 ? `20${hintMatch[2]}` : hintMatch[2];
      return `${term === "Autumn" ? "Fall" : term} ${year}`;
    }
  }
  return null;
}

export function isSeniorRole(title: string): boolean {
  return matchesAny(SENIOR_KEYWORDS, title);
}

/**
 * Hard location policy: US, remote, or hybrid only. Word-boundary matched so
 * "Georgia" (US state) isn't confused with the country, "Ontario, CA"
 * (California) isn't confused with the Canadian province, etc.
 *
 * Deliberately permissive on the "allow" side: a blank/unparseable location,
 * or one with no confident foreign signal, passes through — this blocks
 * clearly-foreign-only postings (the failure mode we actually saw: a Google
 * London role slipping past a location that was only ever a relevance
 * *boost*, never a filter) without silently dropping ambiguous US listings.
 */
const US_MARKERS =
  // Deliberately omit the Indiana abbreviation "IN": browser cards such as
  // IBM's "Gurgaon, IN" use it as India's country code. Indiana locations
  // still pass via explicit US/city signals or the permissive unknown rule.
  /\b(united states|usa|u\.s\.a?\.?|remote|hybrid)\b|\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b|\b(san francisco|new york|nyc|seattle|austin|boston|chicago|los angeles|san jose|sunnyvale|mountain view|santa clara|cupertino|redmond|menlo park|palo alto|san diego|denver|atlanta|miami|dallas|houston|phoenix|tempe|scottsdale|chandler|arlington|reston|pittsburgh|raleigh|durham|charlotte|nashville|columbus|minneapolis|salt lake city|washington,? d\.?c\.?)\b/i;

const NON_US_MARKERS =
  /\b(united kingdom|england|scotland|wales|london|dublin|ireland|canada|toronto|vancouver|montreal|ontario|india|bangalore|bengaluru|hyderabad|mumbai|pune|delhi|gurgaon|germany|berlin|munich|frankfurt|france|paris|singapore|japan|tokyo|china|beijing|shanghai|shenzhen|hong kong|australia|sydney|melbourne|brazil|s[ãa]o paulo|mexico city|poland|warsaw|krak[óo]w|netherlands|amsterdam|spain|madrid|barcelona|israel|tel aviv|south korea|seoul|italy|milan|rome|switzerland|zurich|z[üu]rich|geneva|costa rica|philippines|manila|vietnam|indonesia|jakarta|romania|bucharest|ukraine|kyiv|portugal|lisbon|austria|vienna|belgium|brussels|sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki|new zealand|egypt|cairo|dubai|abu dhabi|saudi arabia|riyadh|argentina|buenos aires|chile|santiago|colombia|bogot[áa]|peru|lima|taiwan|taipei|thailand|bangkok|malaysia|kuala lumpur)\b/i;

export function isUsRemoteOrHybridLocation(location: string | null | undefined): boolean {
  if (!location || !location.trim()) return true; // unknown location: don't over-filter
  if (US_MARKERS.test(location)) return true;
  return !NON_US_MARKERS.test(location);
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
  seasonHint?: string | null,
): Classification {
  const roleType = detectRoleType(title);
  const season = detectSeason(title, seasonHint);
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
