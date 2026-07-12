import { db, newId, now, tables } from "@/db";
import { badRequest, handler, ok } from "@/lib/api";
import { importMatchKey, parseSimplifyCsv } from "@/lib/import/simplify";
import { syncApplicationsToGoogleSheetsSafe } from "@/lib/integrations/google-sheets";
import { PIPELINE_ORDER } from "@/lib/status";
import type { ApplicationStatus } from "@/lib/types";
import { eq } from "drizzle-orm";

/**
 * Import a Simplify.jobs tracker CSV export (or any tracker CSV with
 * company/title columns). multipart: `file` (CSV) + `mode` = "preview" | "commit".
 *
 * Matching: existing application with the same posting URL, else the same
 * normalized company+title. Matched rows update the status (forward-only, so
 * a stale CSV never downgrades your pipeline) and fill missing fields; new
 * rows create applications with a timeline event.
 */
export const POST = handler(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  const mode = form.get("mode") === "commit" ? "commit" : "preview";
  if (!(file instanceof File) || file.size === 0) return badRequest("Missing CSV file");
  if (file.size > 5 * 1024 * 1024) return badRequest("File too large (max 5 MB)");

  const { rows, skipped, missingColumns } = parseSimplifyCsv(await file.text());
  if (missingColumns.length > 0) {
    return badRequest(`CSV is missing required columns: ${missingColumns.join(", ")}`);
  }

  const existing = await db.select().from(tables.applications);
  const byUrl = new Map(existing.filter((a) => a.jobUrl).map((a) => [a.jobUrl!, a]));
  const byKey = new Map(existing.map((a) => [importMatchKey(a.companyName, a.jobTitle), a]));

  const rank = (s: string) => PIPELINE_ORDER.indexOf(s as ApplicationStatus);
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const preview: { companyName: string; jobTitle: string; status: string; action: string }[] = [];

  for (const row of rows) {
    const match = (row.jobUrl && byUrl.get(row.jobUrl)) || byKey.get(importMatchKey(row.companyName, row.jobTitle));
    if (!match) {
      created++;
      preview.push({ companyName: row.companyName, jobTitle: row.jobTitle, status: row.status, action: "create" });
      if (mode === "commit") {
        const t = now();
        const id = newId();
        await db.insert(tables.applications).values({
          id,
          companyName: row.companyName,
          jobTitle: row.jobTitle,
          jobType: row.jobType,
          status: row.status,
          dateApplied: row.dateApplied,
          jobUrl: row.jobUrl,
          location: row.location,
          notes: row.notes,
          tags: JSON.stringify(["simplify"]),
          createdAt: t,
          updatedAt: t,
        });
        await db.insert(tables.statusEvents).values({
          id: newId(),
          applicationId: id,
          fromStatus: null,
          toStatus: row.status,
          note: `Imported from Simplify${row.rawStatus ? ` (status "${row.rawStatus}")` : ""}`,
          createdAt: t,
        });
        // Register the new row so duplicate CSV lines don't double-create.
        const inserted = { ...row, id, companyName: row.companyName, jobTitle: row.jobTitle } as unknown as typeof existing[number];
        byKey.set(importMatchKey(row.companyName, row.jobTitle), inserted);
        if (row.jobUrl) byUrl.set(row.jobUrl, inserted);
      }
      continue;
    }

    // Forward-only status sync: never downgrade an existing application.
    const advances = rank(row.status) > rank(match.status);
    if (!advances) {
      unchanged++;
      preview.push({ companyName: row.companyName, jobTitle: row.jobTitle, status: row.status, action: "skip (already tracked)" });
      continue;
    }
    updated++;
    preview.push({ companyName: row.companyName, jobTitle: row.jobTitle, status: row.status, action: `update ${match.status} → ${row.status}` });
    if (mode === "commit") {
      const t = now();
      await db
        .update(tables.applications)
        .set({
          status: row.status,
          updatedAt: t,
          dateApplied: match.dateApplied ?? row.dateApplied,
          jobUrl: match.jobUrl ?? row.jobUrl,
          location: match.location ?? row.location,
        })
        .where(eq(tables.applications.id, match.id));
      await db.insert(tables.statusEvents).values({
        id: newId(),
        applicationId: match.id,
        fromStatus: match.status,
        toStatus: row.status,
        note: `Synced from Simplify import${row.rawStatus ? ` (status "${row.rawStatus}")` : ""}`,
        createdAt: t,
      });
    }
  }

  const sheetSync = mode === "commit" ? await syncApplicationsToGoogleSheetsSafe("Simplify CSV imported") : null;
  return ok({
    mode,
    totalRows: rows.length,
    skippedRows: skipped,
    created,
    updated,
    unchanged,
    preview: preview.slice(0, 100),
    sheetSync,
  });
});
