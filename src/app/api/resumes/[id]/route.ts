import { eq } from "drizzle-orm";
import { db, now, tables } from "@/db";
import { badRequest, handler, notFound, ok, parseTags } from "@/lib/api";
import { getStorage, makeStorageKey } from "@/lib/storage";
import { resumeInput } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const existing = await db.query.resumes.findFirst({ where: eq(tables.resumes.id, id) });
  if (!existing) return notFound("Resume not found");

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    // Replace the file.
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return badRequest("Missing file");
    if (file.size > 15 * 1024 * 1024) return badRequest("File too large (max 15 MB)");
    const storage = getStorage();
    const key = makeStorageKey(file.name);
    await storage.put(key, Buffer.from(await file.arrayBuffer()), file.type);
    if (existing.storageKey && existing.storageDriver === storage.name) {
      await storage.delete(existing.storageKey).catch(() => {});
    }
    await db
      .update(tables.resumes)
      .set({
        storageKey: key,
        storageDriver: storage.name,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        updatedAt: now(),
      })
      .where(eq(tables.resumes.id, id));
  } else {
    const raw = (await req.json()) as Record<string, unknown>;
    const parsed = resumeInput.partial().parse(raw);
    // zod .partial() still injects .default() values — keep only sent keys.
    const input = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => key in raw),
    ) as typeof parsed;
    const { tags, ...rest } = input;
    await db
      .update(tables.resumes)
      .set({ ...rest, ...(tags !== undefined ? { tags: JSON.stringify(tags) } : {}), updatedAt: now() })
      .where(eq(tables.resumes.id, id));
  }

  const row = await db.query.resumes.findFirst({ where: eq(tables.resumes.id, id) });
  return ok({ ...row, tags: parseTags(row!.tags) });
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const existing = await db.query.resumes.findFirst({ where: eq(tables.resumes.id, id) });
  if (!existing) return notFound("Resume not found");

  const linked = await db.query.applications.findFirst({
    where: (a, { eq: e, or }) => or(e(a.resumeId, id), e(a.coverLetterId, id)),
  });
  if (linked) {
    return badRequest(
      `This resume is linked to "${linked.companyName} — ${linked.jobTitle}". Archive it instead, or unlink it first.`,
    );
  }

  if (existing.storageKey) {
    await getStorage().delete(existing.storageKey).catch(() => {});
  }
  await db.delete(tables.resumes).where(eq(tables.resumes.id, id));
  return ok({ deleted: true });
});
