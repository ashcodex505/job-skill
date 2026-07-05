import { desc } from "drizzle-orm";
import { db, tables } from "@/db";
import { handler, ok, parseTags } from "@/lib/api";

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
    // Descriptions are up to 10k chars × thousands of jobs (a >10 MB payload
    // the dashboard polls every 5 min) — send a flag; fetch text on demand
    // via /api/jobs/[id]/description.
    jobs: jobs.map(({ description, ...j }) => ({
      ...j,
      hasDescription: Boolean(description),
      matchedSkills: parseTags(j.matchedSkills),
      scoreBreakdown: j.scoreBreakdown ? JSON.parse(j.scoreBreakdown) : null,
      isNew: newSince !== null && j.firstSeenAt >= newSince,
    })),
    lastRun,
  });
});
