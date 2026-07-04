import { desc } from "drizzle-orm";
import { db, tables } from "@/db";
import { handler, ok } from "@/lib/api";

export const GET = handler(async () => {
  const [jobs, lastRun] = await Promise.all([
    db
      .select()
      .from(tables.discoveredJobs)
      .orderBy(desc(tables.discoveredJobs.firstSeenAt), desc(tables.discoveredJobs.score)),
    db.query.scraperRuns.findFirst({ orderBy: (r, { desc: d }) => d(r.startedAt) }),
  ]);
  // "New" = first seen during the most recent completed run window.
  const newSince = lastRun?.startedAt ?? null;
  return ok({
    jobs: jobs.map((j) => ({ ...j, isNew: newSince !== null && j.firstSeenAt >= newSince })),
    lastRun,
  });
});
