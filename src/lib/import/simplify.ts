import type { ApplicationStatus } from "@/lib/types";

/**
 * Simplify.jobs tracker CSV import.
 *
 * Simplify has no public API or webhooks — its Copilot extension writes only
 * to Simplify's own backend. The supported data-out path is the tracker's CSV
 * export, so the integration is: export from Simplify → import here.
 * Re-importing is safe: rows are matched against existing applications (by
 * posting URL, else company+title) and either update the status or are
 * skipped, so only genuinely new applications are created.
 *
 * Header names vary across Simplify versions, so headers are matched by
 * normalized synonyms rather than exact strings, which also makes the
 * importer work for generic tracker CSVs (Notion/Sheets exports).
 */

export interface ImportedRow {
  companyName: string;
  jobTitle: string;
  status: ApplicationStatus;
  rawStatus: string | null;
  dateApplied: string | null;
  jobUrl: string | null;
  location: string | null;
  notes: string | null;
}

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, ""); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_SYNONYMS: Record<keyof Omit<ImportedRow, "rawStatus">, string[]> = {
  companyName: ["company", "companyname", "employer", "organization"],
  jobTitle: ["jobtitle", "title", "position", "role", "job", "positiontitle"],
  status: ["status", "applicationstatus", "stage"],
  dateApplied: ["dateapplied", "applieddate", "appliedon", "applicationdate", "dateadded", "appliedat", "date"],
  jobUrl: ["jobpostingurl", "url", "link", "joburl", "posting", "jobposting", "joblink", "applicationlink"],
  location: ["location", "city", "locations", "jobLocation"],
  notes: ["notes", "note", "comments", "description"],
};

export function mapHeaders(headerRow: string[]): Partial<Record<keyof Omit<ImportedRow, "rawStatus">, number>> {
  const mapping: Partial<Record<keyof Omit<ImportedRow, "rawStatus">, number>> = {};
  headerRow.forEach((raw, idx) => {
    const n = norm(raw);
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS) as [keyof Omit<ImportedRow, "rawStatus">, string[]][]) {
      if (mapping[field] === undefined && synonyms.includes(n)) mapping[field] = idx;
    }
  });
  return mapping;
}

/** Simplify tracker stages → our pipeline statuses. */
export function mapStatus(raw: string | null | undefined): ApplicationStatus {
  const n = (raw ?? "").toLowerCase();
  if (/reject|declin|denied/.test(n)) return "rejected";
  if (/accept|offer/.test(n)) return "offer";
  if (/final/.test(n)) return "final_round";
  if (/tech|onsite|on-site/.test(n)) return "technical_interview";
  if (/screen|phone|recruiter/.test(n)) return "recruiter_screen";
  if (/interview/.test(n)) return "technical_interview";
  if (/assessment|online assessment|\boa\b|challenge|test/.test(n)) return "oa_received";
  if (/withdraw|not interested|archiv|ghost/.test(n)) return "withdrawn";
  if (/applied|submitted/.test(n)) return "applied";
  if (/saved|bookmark|applying|interested|wishlist/.test(n)) return "interested";
  return "applied"; // Simplify only auto-tracks completed applications.
}

/** Accepts "2026-07-01", "07/01/2026", "Jul 1, 2026", ISO datetimes. */
export function parseDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export interface ParseResult {
  rows: ImportedRow[];
  skipped: number;
  missingColumns: string[];
}

export function parseSimplifyCsv(text: string): ParseResult {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], skipped: 0, missingColumns: ["company", "job title"] };

  const mapping = mapHeaders(table[0]);
  const missingColumns: string[] = [];
  if (mapping.companyName === undefined) missingColumns.push("company");
  if (mapping.jobTitle === undefined) missingColumns.push("job title");
  if (missingColumns.length > 0) return { rows: [], skipped: table.length - 1, missingColumns };

  const rows: ImportedRow[] = [];
  let skipped = 0;
  for (const cells of table.slice(1)) {
    const get = (field: keyof typeof mapping) => {
      const idx = mapping[field];
      return idx === undefined ? null : (cells[idx]?.trim() || null);
    };
    const companyName = get("companyName");
    const jobTitle = get("jobTitle");
    if (!companyName || !jobTitle) {
      skipped++;
      continue;
    }
    const rawStatus = get("status");
    const url = get("jobUrl");
    rows.push({
      companyName,
      jobTitle,
      status: mapStatus(rawStatus),
      rawStatus,
      dateApplied: parseDate(get("dateApplied")),
      jobUrl: url && /^https?:\/\//i.test(url) ? url : null,
      location: get("location"),
      notes: get("notes"),
    });
  }
  return { rows, skipped, missingColumns: [] };
}

/** Key used to match an imported row against existing applications. */
export function importMatchKey(companyName: string, jobTitle: string): string {
  return `${norm(companyName)}|${norm(jobTitle)}`;
}
