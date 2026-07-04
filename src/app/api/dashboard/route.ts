import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { handler, ok, parseTags } from "@/lib/api";
import { ACTIVE_STATUSES, INTERVIEW_STATUSES, type ApplicationStatus } from "@/lib/types";

export const GET = handler(async () => {
  const [apps, lastRun, discoveredCount] = await Promise.all([
    db.select().from(tables.applications),
    db.query.scraperRuns.findFirst({ orderBy: (r, { desc: d }) => d(r.startedAt) }),
    db.$count(tables.discoveredJobs, eq(tables.discoveredJobs.active, true)),
  ]);

  const byStatus: Record<string, number> = {};
  for (const app of apps) byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;

  const applied = apps.filter((a) => a.status !== "interested").length;
  const active = apps.filter((a) => ACTIVE_STATUSES.includes(a.status as ApplicationStatus)).length;
  const interviews = apps.filter((a) => INTERVIEW_STATUSES.includes(a.status as ApplicationStatus)).length;

  const today = new Date().toISOString().slice(0, 10);
  const nextActions = apps
    .filter((a) => a.nextActionDate)
    .sort((a, b) => a.nextActionDate!.localeCompare(b.nextActionDate!))
    .slice(0, 8)
    .map((a) => ({
      id: a.id,
      companyName: a.companyName,
      jobTitle: a.jobTitle,
      status: a.status,
      nextActionDate: a.nextActionDate,
      nextActionNote: a.nextActionNote,
      overdue: a.nextActionDate! < today,
    }));

  const recent = [...apps]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
    .map((a) => ({ ...a, tags: parseTags(a.tags) }));

  return ok({
    totals: {
      total: apps.length,
      applied,
      active,
      interviews,
      offers: byStatus["offer"] ?? 0,
      rejections: byStatus["rejected"] ?? 0,
      interested: byStatus["interested"] ?? 0,
      discoveredActive: discoveredCount,
    },
    byStatus,
    nextActions,
    recent,
    lastRun: lastRun ? { ...lastRun, errors: JSON.parse(lastRun.errors) } : null,
  });
});
