import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { handler, notFound, ok } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/** On-demand job description (kept out of the /api/jobs list payload). */
export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const job = await db.query.discoveredJobs.findFirst({ where: eq(tables.discoveredJobs.id, id) });
  if (!job) return notFound("Discovered job not found");
  return ok({ description: job.description ?? null });
});
