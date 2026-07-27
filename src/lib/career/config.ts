import fs from "node:fs";
import path from "node:path";

/**
 * Career-ops-style personalization: parse the human-editable markdown files
 * in career/ into the config that steers the scraper. Re-read on every
 * scrape run (cheap), so edits apply without a restart.
 */

export interface CareerConfig {
  skills: string[];
  targetRoles: string[];
  seasons: string[];
  /** Title phrases a full-time role must contain to count as new grad. */
  requiredNewGradTitleKeywords: string[];
  /** Internship seasons that are allowed through the strict career filter. */
  internshipSeasons: string[];
  /** Summer 2027 internship company allowlist; empty disables the company gate. */
  summer2027ApprovedCompanies: string[];
  locations: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  /**
   * Opt-in board-wide freshness gate (career-ops calls this the
   * "posting-age filter"): a posting whose postedAt is older than this many
   * days is dropped before ever reaching the board. null/absent/non-positive
   * = disabled (everything passes) — the default, so existing boards don't
   * change composition unless you turn this on. Matches the same
   * "don't penalize missing data" rule as the rest of this file: a posting
   * with no known postedAt is NEVER dropped by this filter, since there's
   * nothing to compare against.
   */
  maxPostingAgeDays: number | null;
}

export const EMPTY_CONFIG: CareerConfig = {
  skills: [],
  targetRoles: [],
  seasons: [],
  requiredNewGradTitleKeywords: [],
  internshipSeasons: [],
  summer2027ApprovedCompanies: [],
  locations: [],
  positiveKeywords: [],
  negativeKeywords: [],
  maxPostingAgeDays: null,
};

export { parseSection } from "./markdown";
import { parseSection } from "./markdown";

export function parseCareerConfig(profileMd: string, preferencesMd: string): CareerConfig {
  const maxAgeRaw = parseSection(preferencesMd, "Max posting age (days)")[0];
  const maxAgeParsed = maxAgeRaw ? Number(maxAgeRaw) : NaN;
  return {
    skills: parseSection(profileMd, "Skills"),
    targetRoles: parseSection(preferencesMd, "Target roles"),
    seasons: parseSection(preferencesMd, "Seasons"),
    requiredNewGradTitleKeywords: parseSection(preferencesMd, "Required new grad title keywords"),
    internshipSeasons: parseSection(preferencesMd, "Internship seasons"),
    summer2027ApprovedCompanies: parseSection(preferencesMd, "Summer 2027 approved companies"),
    locations: parseSection(preferencesMd, "Preferred locations"),
    positiveKeywords: parseSection(preferencesMd, "Positive title keywords"),
    negativeKeywords: parseSection(preferencesMd, "Negative title keywords"),
    maxPostingAgeDays: Number.isFinite(maxAgeParsed) && maxAgeParsed > 0 ? maxAgeParsed : null,
  };
}

const CAREER_DIR = process.env.CAREER_DIR ?? path.join(process.cwd(), "career");

function readIfExists(file: string): string {
  try {
    return fs.readFileSync(path.join(CAREER_DIR, file), "utf8");
  } catch {
    return "";
  }
}

/** Loads career/profile.md + career/preferences.md; missing files → empty config (built-in defaults apply). */
export function loadCareerConfig(): CareerConfig {
  return parseCareerConfig(readIfExists("profile.md"), readIfExists("preferences.md"));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Fraction of profile skills mentioned in the given text (title + description).
 * Word-boundary matched so "Java" doesn't match "JavaScript"; symbol-bearing
 * skills (C++, C#) fall back to plain substring matching.
 */
export function skillMatch(skills: string[], text: string): { matched: string[]; ratio: number } {
  if (skills.length === 0 || !text) return { matched: [], ratio: 0 };
  const haystack = text.toLowerCase();
  const matched = skills.filter((skill) => {
    const s = skill.trim().toLowerCase();
    if (!s) return false;
    if (/[^a-z0-9 ]/.test(s)) return haystack.includes(s);
    return new RegExp(`\\b${escapeRe(s)}\\b`, "i").test(haystack);
  });
  return { matched, ratio: matched.length / skills.length };
}

/** Strip HTML tags/entities from ATS job descriptions for keyword matching. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
