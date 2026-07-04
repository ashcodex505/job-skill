import { desc } from "drizzle-orm";
import { db, newId, now, tables } from "@/db";
import { badRequest, handler, ok, parseTags } from "@/lib/api";
import { getStorage, makeStorageKey } from "@/lib/storage";
import { resumeInput } from "@/lib/validation";

export const GET = handler(async () => {
  const rows = await db.select().from(tables.resumes).orderBy(desc(tables.resumes.createdAt));
  return ok(rows.map((r) => ({ ...r, tags: parseTags(r.tags) })));
});

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** multipart/form-data: `meta` (JSON) + optional `file` (PDF/DOC/DOCX). */
export const POST = handler(async (req: Request) => {
  const form = await req.formData();
  const metaRaw = form.get("meta");
  if (typeof metaRaw !== "string") return badRequest("Missing meta field");
  const input = resumeInput.parse(JSON.parse(metaRaw));

  const file = form.get("file");
  let fileFields = {};
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return badRequest("File too large (max 15 MB)");
    if (!ALLOWED_TYPES.has(file.type)) return badRequest("Only PDF/DOC/DOCX files are supported");
    const storage = getStorage();
    const key = makeStorageKey(file.name);
    await storage.put(key, Buffer.from(await file.arrayBuffer()), file.type);
    fileFields = {
      storageKey: key,
      storageDriver: storage.name,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    };
  }

  const id = newId();
  const t = now();
  await db.insert(tables.resumes).values({
    id,
    ...input,
    tags: JSON.stringify(input.tags),
    ...fileFields,
    createdAt: t,
    updatedAt: t,
  });
  const row = await db.query.resumes.findFirst({ where: (r, { eq }) => eq(r.id, id) });
  return ok({ ...row, tags: input.tags }, { status: 201 });
});
