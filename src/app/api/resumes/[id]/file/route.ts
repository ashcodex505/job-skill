import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { handler, notFound } from "@/lib/api";
import { getStorage } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/** Streams the stored resume file (inline for browser preview). */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const resume = await db.query.resumes.findFirst({ where: eq(tables.resumes.id, id) });
  if (!resume?.storageKey) return notFound("No file uploaded for this resume");

  const data = await getStorage().get(resume.storageKey);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const disposition = `${download ? "attachment" : "inline"}; filename="${(resume.fileName ?? "resume.pdf").replace(/"/g, "")}"`;
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": resume.mimeType ?? "application/octet-stream",
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
    },
  });
});
