import { compareJobsNewestFirst, type BoardJob } from "./board";

export const RECENT_POSTING_MS = 5 * 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 15 * 60 * 1000;
const HISTORY_START = "<!-- JOB-ALERT-HISTORY:START -->";
const HISTORY_END = "<!-- JOB-ALERT-HISTORY:END -->";
const CYCLE_MARKER = "<!-- JOB-ALERT-CYCLE -->";
const MAX_HISTORY_CYCLES = 12;
const MAX_ISSUE_BODY_CHARS = 60_000;

const escapeCell = (value: string) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function parsedTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function includesTime(value: string | null | undefined): boolean {
  return Boolean(value && /(?:T|\s)\d{2}:\d{2}/.test(value));
}

function hasPrecisePostingTime(job: BoardJob): boolean {
  if (!includesTime(job.postedAt)) return false;
  // Simplify's date_posted is sometimes day-precision encoded as midnight
  // epoch seconds. Calling that an exact time (or ≤5h) would be misleading.
  return !(job.source === "simplifyjobs" && /T00:00:00(?:\.000)?Z$/.test(job.postedAt ?? ""));
}

function utcMinute(value: string): string {
  const time = parsedTime(value);
  return time === null ? "Unknown" : `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function ageLabel(ageMs: number): string {
  const safeAge = Math.max(0, ageMs);
  const minutes = Math.floor(safeAge / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours}h ${remainingMinutes}m ago` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function isRecentlyPosted(job: BoardJob, now: string): boolean {
  if (!hasPrecisePostingTime(job)) return false;
  const posted = parsedTime(job.postedAt);
  const current = parsedTime(now);
  if (posted === null || current === null) return false;
  const age = current - posted;
  return age >= -FUTURE_CLOCK_SKEW_MS && age <= RECENT_POSTING_MS;
}

/** GitHub/Actions table: provider posting time, newest first, and a ≤5h flag. */
export function renderNewJobsAlertTable(jobs: BoardJob[], now: string, cap = 50): string {
  if (jobs.length === 0) return "";
  const shown = [...jobs].sort(compareJobsNewestFirst).slice(0, cap);
  const rows = shown.map((job) => {
    const recent = isRecentlyPosted(job, now);
    const postedTime = parsedTime(job.postedAt);
    const currentTime = parsedTime(now);
    const precisePostingTime = hasPrecisePostingTime(job);
    const posted = !job.postedAt
      ? `Unknown *(first seen ${utcMinute(job.firstSeenAt)})*`
      : precisePostingTime
        ? utcMinute(job.postedAt)
        : `${job.postedAt.slice(0, 10)} *(time unavailable)*`;
    const age = precisePostingTime && postedTime !== null && currentTime !== null
      ? ageLabel(currentTime - postedTime)
      : "—";
    const emphasize = (value: string) => (recent ? `**${value}**` : value);
    return [
      recent ? "🚨 **JUST POSTED ≤5h**" : "",
      emphasize(escapeCell(job.company)),
      emphasize(escapeCell(job.title)),
      emphasize(posted),
      emphasize(age),
      escapeCell(job.season ?? "—"),
      `${job.score}%`,
      `[Apply](${job.url})`,
    ].join(" | ").replace(/^/, "| ").concat(" |");
  });
  const note =
    "_Newest posting time first. 🚨 marks jobs posted within 5 hours. Date-only sources are labeled time unavailable; if an ATS provides no posted date, first-seen time is shown instead._";
  const table = [
    "| Fresh | Company | Role | Posted (UTC) | Age | Season | Match | Apply |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
  const truncated = jobs.length > cap ? `\n\n_Showing the newest ${cap} of ${jobs.length} jobs from this run._` : "";
  return `${note}\n\n${table}${truncated}`;
}

export interface JobAlertCycle {
  runAt: string;
  count: number;
  table: string;
}

function cycleSection(cycle: JobAlertCycle): string {
  return `${CYCLE_MARKER}\n## ${utcMinute(cycle.runAt)} — ${cycle.count} new job${cycle.count === 1 ? "" : "s"}\n\n${cycle.table.trim()}`;
}

function previousCycles(previousBody: string): string[] {
  const start = previousBody.indexOf(HISTORY_START);
  const end = previousBody.indexOf(HISTORY_END);
  if (start === -1 || end <= start) {
    const legacy = previousBody.trim();
    return legacy ? [`${CYCLE_MARKER}\n## Previous alert — legacy format\n\n${legacy}`] : [];
  }
  return previousBody
    .slice(start + HISTORY_START.length, end)
    .split(CYCLE_MARKER)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${CYCLE_MARKER}\n${part}`);
}

/** Rolling GitHub issue body whose workflow-run sections are newest first. */
export function buildJobAlertIssueBody(previousBody: string, cycle: JobAlertCycle, owner: string): string {
  const cycles = [cycleSection(cycle), ...previousCycles(previousBody)].slice(0, MAX_HISTORY_CYCLES);
  const header = [
    "# 🆕 Job alerts — newest first",
    "",
    `cc @${owner} — the latest job-board workflow run is always at the top.`,
    "",
    "🚨 **JUST POSTED ≤5h** highlights the most time-sensitive openings. Times are normalized to UTC.",
    "See the complete current list in [JOBS.md](../blob/main/JOBS.md).",
    "",
    HISTORY_START,
  ].join("\n");
  const footer = `\n${HISTORY_END}\n`;
  while (cycles.length > 1 && `${header}\n${cycles.join("\n\n---\n\n")}${footer}`.length > MAX_ISSUE_BODY_CHARS) {
    cycles.pop();
  }
  return `${header}\n${cycles.join("\n\n---\n\n")}${footer}`;
}
