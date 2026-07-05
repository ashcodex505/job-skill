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

  const raw = (await req.json()) as Record<string, unknown>;
  const parsed = applicationInput.partial().parse(raw);
  // zod .partial() still injects .default() values — keep only keys the
  // client actually sent, or a partial PATCH would reset other fields.
  const input = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key in raw),
  ) as typeof parsed;
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
  // Unlink from Job Discovery so the posting can be saved again.
  await db
    .update(tables.discoveredJobs)
    .set({ savedApplicationId: null })
    .where(eq(tables.discoveredJobs.savedApplicationId, id));
  // status_events and credentials cascade via FK.
  await db.delete(tables.applications).where(eq(tables.applications.id, id));
  return ok({ deleted: true });
});
