import { desc } from "drizzle-orm";
import { db, newId, now, tables } from "@/db";
import { handler, ok, parseTags } from "@/lib/api";
import { syncApplicationsToGoogleSheetsSafe } from "@/lib/integrations/google-sheets";
import { applicationInput } from "@/lib/validation";

export const GET = handler(async () => {
  const rows = await db.select().from(tables.applications).orderBy(desc(tables.applications.updatedAt));
  const creds = await db
    .select({ applicationId: tables.credentials.applicationId })
    .from(tables.credentials);
  const withCreds = new Set(creds.map((c) => c.applicationId));
  return ok(
    rows.map((r) => ({ ...r, tags: parseTags(r.tags), hasCredential: withCreds.has(r.id) })),
  );
});

export const POST = handler(async (req: Request) => {
  const input = applicationInput.parse(await req.json());
  const id = newId();
  const t = now();
  await db.insert(tables.applications).values({
    id,
    ...input,
    tags: JSON.stringify(input.tags),
    createdAt: t,
    updatedAt: t,
  });
  await db.insert(tables.statusEvents).values({
    id: newId(),
    applicationId: id,
    fromStatus: null,
    toStatus: input.status,
    note: input.status === "applied" ? "Application submitted" : "Created",
    createdAt: t,
  });
  const row = await db.query.applications.findFirst({ where: (a, { eq }) => eq(a.id, id) });
  await syncApplicationsToGoogleSheetsSafe("application created");
  return ok({ ...row, tags: input.tags }, { status: 201 });
});
