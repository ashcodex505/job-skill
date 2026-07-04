import { eq } from "drizzle-orm";
import { db, newId, now, tables } from "@/db";
import { badRequest, handler, notFound, ok } from "@/lib/api";
import { canTransition } from "@/lib/status";
import type { ApplicationStatus } from "@/lib/types";
import { statusUpdateInput } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const app = await db.query.applications.findFirst({ where: eq(tables.applications.id, id) });
  if (!app) return notFound("Application not found");

  const { status, note } = statusUpdateInput.parse(await req.json());
  if (!canTransition(app.status as ApplicationStatus, status)) {
    return badRequest(`Application is already in status "${status}"`);
  }

  const t = now();
  await db
    .update(tables.applications)
    .set({
      status,
      updatedAt: t,
      // First move to "applied" stamps the applied date if it's not set.
      ...(status === "applied" && !app.dateApplied ? { dateApplied: t.slice(0, 10) } : {}),
    })
    .where(eq(tables.applications.id, id));
  await db.insert(tables.statusEvents).values({
    id: newId(),
    applicationId: id,
    fromStatus: app.status,
    toStatus: status,
    note,
    createdAt: t,
  });

  const row = await db.query.applications.findFirst({ where: eq(tables.applications.id, id) });
  return ok(row);
});
