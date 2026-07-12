import { eq } from "drizzle-orm";
import { db, newId, now, tables } from "@/db";
import { badRequest, handler, notFound, ok } from "@/lib/api";
import { syncApplicationsToGoogleSheetsSafe } from "@/lib/integrations/google-sheets";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const saveInput = z.object({
  /** "interested" (default) or "applied" for the mark-applied flow. */
  markApplied: z.boolean().default(false),
});

/** Save a discovered job into the tracker as a new application. */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const job = await db.query.discoveredJobs.findFirst({ where: eq(tables.discoveredJobs.id, id) });
  if (!job) return notFound("Discovered job not found");
  if (job.savedApplicationId) {
    const existing = await db.query.applications.findFirst({
      where: eq(tables.applications.id, job.savedApplicationId),
    });
    if (existing) return badRequest("Already saved to tracker");
  }

  const { markApplied } = saveInput.parse(await req.json().catch(() => ({})));
  const status = markApplied ? "applied" : "interested";
  const t = now();
  const appId = newId();

  await db.insert(tables.applications).values({
    id: appId,
    companyId: job.companyId,
    companyName: job.company,
    jobTitle: job.title,
    jobType: job.roleType === "internship" ? "internship" : job.roleType === "new_grad" ? "new_grad" : "other",
    season: job.season,
    location: job.location,
    workMode: /remote/i.test(job.location ?? "") ? "remote" : "unknown",
    jobUrl: job.url,
    status,
    dateApplied: markApplied ? t.slice(0, 10) : null,
    tags: JSON.stringify(["discovered"]),
    discoveredJobId: job.id,
    createdAt: t,
    updatedAt: t,
  });
  await db.insert(tables.statusEvents).values({
    id: newId(),
    applicationId: appId,
    fromStatus: null,
    toStatus: status,
    note: `Saved from Job Discovery (${job.source})`,
    createdAt: t,
  });
  await db
    .update(tables.discoveredJobs)
    .set({ savedApplicationId: appId })
    .where(eq(tables.discoveredJobs.id, id));

  const row = await db.query.applications.findFirst({ where: eq(tables.applications.id, appId) });
  await syncApplicationsToGoogleSheetsSafe("discovered job saved");
  return ok(row, { status: 201 });
});
