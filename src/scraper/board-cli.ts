import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/db";
import { parsePriorityCompanies } from "@/lib/career/priority";
import { matchWatches, parseWatchlist } from "@/lib/career/watchlist";
import { filterUnalerted, recordAlerted, selectBigTechAlerts, type AlertLedger } from "./big-tech-alert";
import { closeJobs, diffNewJobs, mergeBoard, renderJobsMarkdown, updateReadme, type BoardData, type BoardJob } from "./board";
import { renderNewJobsAlertTable } from "./job-alert";
import { COMPANY_PORTALS } from "./registry";
import { runScraper } from "./run";

/**
 * `npm run board [-- --company Stripe] [--no-linkcheck] [--watch]` — scrape,
 * then
 * regenerate the committed job board: board/jobs.json (state), JOBS.md
 * (full board), and the marker-delimited section in README.md. Used locally
 * and by the 12h GitHub Action, which also consumes the summary outputs
 * written to $GITHUB_OUTPUT / $GITHUB_STEP_SUMMARY / $BOARD_NEW_JOBS_FILE.
 */
const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, "board", "jobs.json");
const JOBS_MD = path.join(ROOT, "JOBS.md");
const README_MD = path.join(ROOT, "README.md");

const LINKCHECK_CONCURRENCY = 5;
const LINKCHECK_TIMEOUT_MS = 10_000;

/**
 * Returns dedupe keys whose posting URL is definitively gone (404/410 only —
 * network errors, 403s, rate limits etc. are NOT evidence of closure).
 */
async function findDeadJobs(jobs: BoardJob[]): Promise<Set<string>> {
  const dead = new Set<string>();
  const queue = [...jobs];

  async function probe(url: string): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LINKCHECK_TIMEOUT_MS);
    try {
      let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
      }
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  }

  await Promise.all(
    Array.from({ length: LINKCHECK_CONCURRENCY }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          const status = await probe(job.url);
          if (status === 404 || status === 410) dead.add(job.dedupeKey);
        } catch {
          // Timeout / network error: keep the job.
        }
      }
    }),
  );
  return dead;
}

function writeIfEnv(envVar: string, content: string, append: boolean): void {
  const file = process.env[envVar];
  if (!file) return;
  if (append) fs.appendFileSync(file, content);
  else fs.writeFileSync(file, content);
}

function loadWatches() {
  try {
    return parseWatchlist(fs.readFileSync(path.join(ROOT, "career", "watchlist.md"), "utf8"));
  } catch {
    return [];
  }
}

function loadPriorityCompanies(): string[] {
  try {
    return parsePriorityCompanies(fs.readFileSync(path.join(ROOT, "career", "priority-companies.md"), "utf8"));
  } catch {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const companies: string[] = [];
  const watchMode = args.includes("--watch");
  const priorityMode = args.includes("--priority");
  let linkcheck = !args.includes("--no-linkcheck");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--company" && args[i + 1]) companies.push(args[++i]);
  }

  const watches = loadWatches();
  if (watchMode) {
    // Lightweight hourly mode: only watchlisted supported companies + the
    // community feeds (SimplifyJobs, speedyapply, vansh — which cover
    // unsupported companies like Google).
    const watched = new Set(watches.map((w) => w.company.toLowerCase()));
    for (const portal of COMPANY_PORTALS) {
      if (portal.ats !== "unsupported" && watched.has(portal.name.toLowerCase())) companies.push(portal.name);
    }
    linkcheck = false;
    console.log(`Watch mode: ${watches.length} watches → scraping ${companies.length} supported companies + community feeds`);
  }
  if (priorityMode) {
    // Fast lane, every ~30 min: Amazon always, plus whatever the dashboard's
    // Priority companies panel added. No feed here — the gated feed-watch
    // job already covers that on its own schedule. One cheap call per
    // company, so this stays fine to run often.
    const extra = loadPriorityCompanies();
    const wanted = new Set(["amazon", ...extra.map((c) => c.toLowerCase())]);
    for (const portal of COMPANY_PORTALS) {
      if (portal.ats !== "unsupported" && wanted.has(portal.name.toLowerCase())) companies.push(portal.name);
    }
    linkcheck = false;
    console.log(`Priority mode: scraping ${companies.length} companies (Amazon + ${extra.length} added)`);
  }
  // Partial runs skip the link check — it would probe companies we didn't scrape.
  if (!watchMode && !priorityMode && companies.length > 0) linkcheck = false;

  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`Scraping${companies.length ? ` (${companies.join(", ") || "feed only"})` : ""}...`);
  const summary = await runScraper(
    watchMode ? { companies, simplifyFeed: true } : companies.length > 0 ? { companies } : {},
  );

  let previous: BoardData | null = null;
  try {
    previous = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    /* first run */
  }

  const now = new Date().toISOString();
  let board = mergeBoard(previous, summary.jobs, now, {
    companies: summary.scannedCompanies,
    sources: summary.scannedSources,
  });

  if (linkcheck && board.jobs.length > 0) {
    console.log(`Link-checking ${board.jobs.length} posting URLs...`);
    const dead = await findDeadJobs(board.jobs);
    if (dead.size > 0) console.log(`  ${dead.size} dead links (404/410) moved to closed.`);
    board = closeJobs(board, dead, now);
  }

  // Diff vs the previous board for humans and CI. "New" is decided by
  // canonical URL across active + recently-closed rows, so a posting that
  // switched sources or briefly closed never re-alerts (see diffNewJobs).
  const newJobs = diffNewJobs(previous, board);
  // Belt and suspenders: the committed ledger of already-notified postings.
  const ledgerFile = path.join(ROOT, "board", "alerted.json");
  let ledger: AlertLedger = {};
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  } catch {
    /* first run */
  }
  // Urgent = watchlist matches among jobs that appeared THIS cycle.
  const urgent = filterUnalerted(ledger, matchWatches(watches, newJobs));

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(board, null, 1));
  fs.writeFileSync(JOBS_MD, renderJobsMarkdown(board, urgent));
  fs.writeFileSync(README_MD, updateReadme(fs.readFileSync(README_MD, "utf8"), board, urgent));
  const closedNow = (board.closed ?? []).filter((c) => c.closedAt === now).length;
  const summaryLine = `+${newJobs.length} new, ${closedNow} closed, ${board.jobs.length} total`;
  console.log(`Board updated (${summaryLine}) → JOBS.md, README.md, board/jobs.json`);
  if (summary.errors.length > 0) {
    console.log(`Company errors: ${summary.errors.map((e) => e.company).join(", ")}`);
  }

  // GitHub Actions integration: commit-message line + run summary + issue body.
  const urgentTitle =
    urgent.length === 1 ? `${urgent[0].company} — ${urgent[0].title}`.replace(/[\r\n]/g, " ").slice(0, 150) : `${urgent.length} watchlist matches`;
  if (urgent.length > 0) console.log(`🚨 URGENT: ${urgent.map((j) => `${j.company} — ${j.title}`).join(" | ")}`);
  writeIfEnv(
    "GITHUB_OUTPUT",
    `summary=${summaryLine}\nnew_count=${newJobs.length}\nurgent_count=${urgent.length}\nurgent_title=${urgentTitle}\n`,
    true,
  );
  const newJobsTable = renderNewJobsAlertTable(newJobs, now);
  writeIfEnv(
    "GITHUB_STEP_SUMMARY",
    `## Job board: ${summaryLine}\n\n${newJobsTable || "_No new roles this cycle._"}\n`,
    true,
  );
  if (newJobsTable) writeIfEnv("BOARD_NEW_JOBS_FILE", `${newJobsTable}\n`, false);
  if (urgent.length > 0) {
    const urgentTable = renderNewJobsAlertTable(urgent, now);
    writeIfEnv("BOARD_URGENT_FILE", `${urgentTable}\n`, false);
  }

  // Big-tech/unicorn stream: separate high-signal issue, never double-firing
  // for jobs the watchlist already alerted on.
  const bigTech = filterUnalerted(ledger, selectBigTechAlerts(newJobs, urgent));
  const bigTechTitle =
    bigTech.length === 1
      ? `${bigTech[0].company} — ${bigTech[0].title}`.replace(/[\r\n]/g, " ").slice(0, 150)
      : `${bigTech.length} new big-tech roles`;
  if (bigTech.length > 0) {
    console.log(`⭐ Big tech: ${bigTech.map((j) => `${j.company} — ${j.title}`).join(" | ")}`);
    writeIfEnv("BOARD_BIGTECH_FILE", `${renderNewJobsAlertTable(bigTech, now)}\n`, false);
  }
  writeIfEnv("GITHUB_OUTPUT", `bigtech_count=${bigTech.length}\nbigtech_title=${bigTechTitle}\n`, true);

  // Record everything we are about to notify on so it can never re-alert.
  const alerted = [...urgent, ...bigTech];
  if (alerted.length > 0) {
    fs.writeFileSync(ledgerFile, JSON.stringify(recordAlerted(ledger, alerted, now), null, 1));
  }

  // Sanity check the marker invariant before letting CI commit the result.
  const readme = fs.readFileSync(README_MD, "utf8");
  if (readme.split("<!-- JOB-BOARD:START -->").length !== 2) {
    throw new Error("README job-board markers corrupted — aborting");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
