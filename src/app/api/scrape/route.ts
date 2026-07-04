import { desc } from "drizzle-orm";
import { db, tables } from "@/db";
import { handler, ok } from "@/lib/api";
import { runScraper } from "@/scraper/run";

export const GET = handler(async () => {
  const runs = await db
    .select()
    .from(tables.scraperRuns)
    .orderBy(desc(tables.scraperRuns.startedAt))
    .limit(10);
  return ok(runs.map((r) => ({ ...r, errors: JSON.parse(r.errors) })));
});

/** Trigger a scrape from the UI. Runs inline; ~30-60s for all companies. */
export const POST = handler(async () => {
  const summary = await runScraper();
  return ok({
    runId: summary.runId,
    companiesScanned: summary.companiesScanned,
    jobsFound: summary.jobsFound,
    newJobs: summary.newJobs,
    errors: summary.errors,
  });
});

export const maxDuration = 300;
