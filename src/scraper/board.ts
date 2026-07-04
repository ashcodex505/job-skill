import type { NormalizedJob } from "./normalize";

/**
 * Markdown job board (jobscanner-style): JOBS.md at the repo root with every
 * open early-career role and an Apply link, plus a top-picks section injected
 * into README.md between markers. Regenerated locally via `npm run board` and
 * every 12h by .github/workflows/job-board.yml.
 */

export interface BoardJob {
  dedupeKey: string;
  source: string;
  company: string;
  title: string;
  location: string | null;
  url: string;
  season: string | null;
  roleType: string;
  score: number;
  matchedSkills: string[];
  firstSeenAt: string;
}

export interface BoardData {
  updatedAt: string;
  jobs: BoardJob[];
}

/** Merge a fresh scrape with the previous board so firstSeenAt survives CI runs. */
export function mergeBoard(previous: BoardData | null, scraped: NormalizedJob[], now: string): BoardData {
  const prevByKey = new Map((previous?.jobs ?? []).map((j) => [j.dedupeKey, j]));
  const jobs: BoardJob[] = scraped.map((j) => ({
    dedupeKey: j.dedupeKey,
    source: j.source,
    company: j.company,
    title: j.title,
    location: j.location,
    url: j.url,
    season: j.season,
    roleType: j.roleType,
    score: j.score,
    matchedSkills: j.matchedSkills,
    firstSeenAt: prevByKey.get(j.dedupeKey)?.firstSeenAt ?? now,
  }));
  return { updatedAt: now, jobs };
}

const NEW_WINDOW_MS = 13 * 60 * 60 * 1000; // a hair over the 12h schedule

export function isNewJob(job: BoardJob, updatedAt: string): boolean {
  return new Date(updatedAt).getTime() - new Date(job.firstSeenAt).getTime() < NEW_WINDOW_MS;
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const day = (iso: string) => iso.slice(0, 10);

function jobRow(j: BoardJob, updatedAt: string): string {
  const badge = isNewJob(j, updatedAt) ? " 🆕" : "";
  const match = j.matchedSkills.length > 0 ? `${j.score}% (${j.matchedSkills.length} skills)` : `${j.score}%`;
  return `| ${esc(j.company)} | ${esc(j.title)}${badge} | ${esc(j.location ?? "—")} | ${esc(j.season ?? "—")} | ${match} | ${day(j.firstSeenAt)} | [**Apply ➜**](${j.url}) |`;
}

const TABLE_HEADER = `| Company | Role | Location | Season | Match | First seen | Apply |
|---|---|---|---|---|---|---|`;

function section(title: string, jobs: BoardJob[], updatedAt: string, cap = 400): string {
  if (jobs.length === 0) return "";
  const rows = jobs.slice(0, cap).map((j) => jobRow(j, updatedAt));
  const truncated = jobs.length > cap ? `\n_…and ${jobs.length - cap} more (raise the cap in src/scraper/board.ts)._` : "";
  return `\n## ${title} (${jobs.length})\n\n${TABLE_HEADER}\n${rows.join("\n")}\n${truncated}`;
}

const byScore = (a: BoardJob, b: BoardJob) =>
  b.score - a.score || b.firstSeenAt.localeCompare(a.firstSeenAt) || a.company.localeCompare(b.company);

export function renderJobsMarkdown(board: BoardData): string {
  const jobs = [...board.jobs].sort(byScore);
  const fresh = jobs.filter((j) => isNewJob(j, board.updatedAt));
  const interns = jobs.filter((j) => j.roleType === "internship");
  const newGrad = jobs.filter((j) => j.roleType === "new_grad");
  const other = jobs.filter((j) => j.roleType !== "internship" && j.roleType !== "new_grad");
  const companies = new Set(jobs.map((j) => j.company)).size;

  return `# 🎯 Job Board — SWE Early Career

**${jobs.length} open roles** across **${companies} companies**, scraped from official Greenhouse / Lever / Ashby / Workday APIs and scored against [career/profile.md](career/profile.md).
Last updated: **${board.updatedAt.slice(0, 16).replace("T", " ")} UTC** · auto-refreshed every 12h by [job-board.yml](.github/workflows/job-board.yml) · 🆕 = new since the last update.
**Match** = how well the role fits you, 0–100%: role type + intern/new-grad fit + your target season/location, plus how many skills from [career/profile.md](career/profile.md) appear in the posting (shown in parentheses).
${section("🆕 New this cycle", fresh, board.updatedAt, 100)}${section("🛠️ Internships", interns, board.updatedAt)}${section("🎓 New Grad", newGrad, board.updatedAt)}${section("🔍 Other early-career matches", other, board.updatedAt)}
`;
}

export const README_START = "<!-- JOB-BOARD:START -->";
export const README_END = "<!-- JOB-BOARD:END -->";

export function renderReadmeSection(board: BoardData, top = 20): string {
  const jobs = [...board.jobs].sort(byScore).slice(0, top);
  const rows = jobs.map((j) => jobRow(j, board.updatedAt));
  return `${README_START}
## 🎯 Top job matches right now

Updated **${board.updatedAt.slice(0, 16).replace("T", " ")} UTC** · ${board.jobs.length} open roles tracked · **[Full job board ➜ JOBS.md](JOBS.md)**

${TABLE_HEADER}
${rows.join("\n")}
${README_END}`;
}

/** Replace (or append) the marker-delimited board section in README content. */
export function updateReadme(readme: string, board: BoardData): string {
  const sectionMd = renderReadmeSection(board);
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start !== -1 && end !== -1) {
    return readme.slice(0, start) + sectionMd + readme.slice(end + README_END.length);
  }
  return `${readme.trimEnd()}\n\n${sectionMd}\n`;
}
