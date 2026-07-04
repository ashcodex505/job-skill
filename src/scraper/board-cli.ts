import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/db";
import { mergeBoard, renderJobsMarkdown, updateReadme, type BoardData } from "./board";
import { runScraper } from "./run";

/**
 * `npm run board [-- --company Stripe]` — scrape, then regenerate the
 * committed job board: board/jobs.json (state), JOBS.md (full board), and the
 * marker-delimited section in README.md. Used locally and by the 12h
 * GitHub Action.
 */
const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, "board", "jobs.json");
const JOBS_MD = path.join(ROOT, "JOBS.md");
const README_MD = path.join(ROOT, "README.md");

async function main() {
  const args = process.argv.slice(2);
  const companies: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--company" && args[i + 1]) companies.push(args[++i]);
  }

  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`Scraping${companies.length ? ` (${companies.join(", ")})` : ""}...`);
  const summary = await runScraper(companies.length > 0 ? { companies } : {});

  let previous: BoardData | null = null;
  try {
    previous = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    /* first run */
  }

  // Partial scrapes (--company) merge into the previous board instead of replacing it.
  let scraped = summary.jobs;
  if (companies.length > 0 && previous) {
    const scrapedCompanies = new Set(scraped.map((j) => j.company.toLowerCase()));
    const kept = previous.jobs.filter((j) => !scrapedCompanies.has(j.company.toLowerCase()));
    scraped = [
      ...scraped,
      ...kept.map((j) => ({ ...j, matchedSkills: j.matchedSkills ?? [], sourceId: null, postedAt: null }) as (typeof scraped)[number]),
    ];
  }

  const board = mergeBoard(previous, scraped, new Date().toISOString());
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(board, null, 1));
  fs.writeFileSync(JOBS_MD, renderJobsMarkdown(board));
  fs.writeFileSync(README_MD, updateReadme(fs.readFileSync(README_MD, "utf8"), board));

  console.log(`Board updated: ${board.jobs.length} roles → JOBS.md, README.md, board/jobs.json`);
  if (summary.errors.length > 0) {
    console.log(`Company errors: ${summary.errors.map((e) => e.company).join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
