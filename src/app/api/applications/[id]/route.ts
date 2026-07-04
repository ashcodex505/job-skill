import { asc, eq } from "drizzle-orm";
import { db, now, tables } from "@/db";
import { handler, notFound, ok, parseTags } from "@/lib/api";
import { toCredentialView } from "@/lib/security/credentials";
import { applicationInput } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const app = await db.query.applications.findFirst({ where: eq(tables.applications.id, id) });
  if (!app) return notFound("Application not found");

  const [events, credential, resume, coverLetter] = await Promise.all([
    db
      .select()
      .from(tables.statusEvents)
      .where(eq(tables.statusEvents.applicationId, id))
      .orderBy(asc(tables.statusEvents.createdAt)),
    db.query.credentials.findFirst({ where: eq(tables.credentials.applicationId, id) }),
    app.resumeId ? db.query.resumes.findFirst({ where: eq(tables.resumes.id, app.resumeId) }) : null,
    app.coverLetterId
      ? db.query.resumes.findFirst({ where: eq(tables.resumes.id, app.coverLetterId) })
      : null,
  ]);

  return ok({
    ...app,
    tags: parseTags(app.tags),
    events,
    credential: credential ? toCredentialView(credential) : null,
    resume: resume ? { ...resume, tags: parseTags(resume.tags) } : null,
    coverLetter: coverLetter ? { ...coverLetter, tags: parseTags(coverLetter.tags) } : null,
  });
});

export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const existing = await db.query.applications.findFirst({ where: eq(tables.applications.id, id) });
  if (!existing) return notFound("Application not found");

  const input = applicationInput.partial().parse(await req.json());
  // Status changes must go through /status so the timeline stays consistent.
  const { tags, status, ...rest } = input;
  void status;
  await db
    .update(tables.applications)
    .set({
      ...rest,
      ...(tags !== undefined ? { tags: JSON.stringify(tags) } : {}),
      updatedAt: now(),
    })
    .where(eq(tables.applications.id, id));

  const row = await db.query.applications.findFirst({ where: eq(tables.applications.id, id) });
  return ok({ ...row, tags: parseTags(row!.tags) });
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  // status_events and credentials cascade via FK.
  await db.delete(tables.applications).where(eq(tables.applications.id, id));
  return ok({ deleted: true });
});
