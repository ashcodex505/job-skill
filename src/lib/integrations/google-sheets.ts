import { createSign } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, now, tables } from "@/db";
import { JOB_TYPE_LABELS, STATUS_LABELS, type ApplicationStatus, type JobType } from "@/lib/types";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const LAST_SYNC_KEY = "google_sheets_last_sync";
const COLUMN_COUNT = 10;

const HEADERS = [
  "Company",
  "Type",
  "Position",
  "Application Email",
  "Status",
  "Notes",
  "Date Applied",
  "Job URL",
  "Location",
  "Last Updated (UTC)",
] as const;

interface ServiceAccount {
  type: "service_account";
  client_email: string;
  private_key: string;
  token_uri: string;
}

export interface SheetApplication {
  companyName: string;
  jobType: string;
  jobTitle: string;
  status: string;
  notes: string | null;
  dateApplied: string | null;
  jobUrl: string | null;
  location: string | null;
  updatedAt: string;
}

export type GoogleSheetsSyncResult =
  | { status: "disabled"; rows: 0; syncedAt: null; message: string }
  | { status: "synced"; rows: number; syncedAt: string; spreadsheetUrl: string }
  | { status: "failed"; rows: number; syncedAt: string; message: string };

export interface GoogleSheetsIntegrationStatus {
  configured: boolean;
  spreadsheetId: string | null;
  sheetTab: string | null;
  lastSync: GoogleSheetsSyncResult | null;
}

interface GoogleSheetsConfig {
  serviceAccount: ServiceAccount;
  spreadsheetId: string;
  sheetTab: string;
  defaultApplicationEmail: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;
let syncQueue: Promise<GoogleSheetsSyncResult> = Promise.resolve({
  status: "disabled",
  rows: 0,
  syncedAt: null,
  message: "Not started",
});

function configValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(
    configValue("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64") &&
      configValue("GOOGLE_SHEETS_SPREADSHEET_ID") &&
      configValue("GOOGLE_SHEETS_TAB"),
  );
}

function loadConfig(): GoogleSheetsConfig | null {
  if (!isGoogleSheetsConfigured()) return null;

  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(
      Buffer.from(configValue("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"), "base64").toString("utf8"),
    ) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64-encoded JSON");
  }
  if (
    serviceAccount.type !== "service_account" ||
    !serviceAccount.client_email?.endsWith(".iam.gserviceaccount.com") ||
    !serviceAccount.private_key?.includes("BEGIN PRIVATE KEY") ||
    serviceAccount.token_uri !== "https://oauth2.googleapis.com/token"
  ) {
    throw new Error("Google service-account JSON is missing required fields");
  }

  return {
    serviceAccount,
    spreadsheetId: configValue("GOOGLE_SHEETS_SPREADSHEET_ID"),
    sheetTab: configValue("GOOGLE_SHEETS_TAB"),
    defaultApplicationEmail: configValue("GOOGLE_SHEETS_DEFAULT_APPLICATION_EMAIL"),
  };
}

const base64Url = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: SHEETS_SCOPE,
      aud: serviceAccount.token_uri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || `Google OAuth failed (${response.status})`);
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

async function sheetsRequest(
  config: GoogleSheetsConfig,
  suffix: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const token = await getAccessToken(config.serviceAccount);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}${suffix}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    [key: string]: unknown;
  };
  if (!response.ok) {
    if (response.status === 401) cachedToken = null;
    throw new Error(body.error?.message || `Google Sheets API failed (${response.status})`);
  }
  return body;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status as ApplicationStatus] ?? status;
}

function jobTypeLabel(jobType: string): string {
  return JOB_TYPE_LABELS[jobType as JobType] ?? jobType;
}

export function buildApplicationSheetRows(
  applications: SheetApplication[],
  defaultApplicationEmail: string,
): string[][] {
  return [
    [...HEADERS],
    ...applications.map((application) => [
      application.companyName,
      jobTypeLabel(application.jobType),
      application.jobTitle,
      defaultApplicationEmail,
      statusLabel(application.status),
      application.notes ?? "",
      application.dateApplied ?? "",
      application.jobUrl ?? "",
      application.location ?? "",
      application.updatedAt,
    ]),
  ];
}

async function sheetMetadata(config: GoogleSheetsConfig): Promise<{ sheetId: number; rowCount: number }> {
  const metadata = await sheetsRequest(
    config,
    "?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
  );
  const sheets = (metadata.sheets ?? []) as Array<{
    properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } };
  }>;
  const target = sheets.find((sheet) => sheet.properties?.title === config.sheetTab)?.properties;
  if (!target?.sheetId && target?.sheetId !== 0) {
    throw new Error(`Google Sheet tab "${config.sheetTab}" was not found`);
  }
  if ((target.gridProperties?.columnCount ?? 0) < COLUMN_COUNT) {
    throw new Error(`Google Sheet tab "${config.sheetTab}" must have at least ${COLUMN_COUNT} columns`);
  }
  return { sheetId: target.sheetId, rowCount: target.gridProperties?.rowCount ?? 1000 };
}

async function writeSheet(
  config: GoogleSheetsConfig,
  rows: string[][],
  metadata: { sheetId: number; rowCount: number },
): Promise<void> {
  const quotedTab = `'${config.sheetTab.replace(/'/g, "''")}'`;
  const writeRange = `${quotedTab}!A1:J${rows.length}`;
  await sheetsRequest(
    config,
    `/values/${encodeURIComponent(writeRange)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({ range: writeRange, majorDimension: "ROWS", values: rows }),
    },
  );

  if (rows.length < metadata.rowCount) {
    const staleRange = `${quotedTab}!A${rows.length + 1}:J${metadata.rowCount}`;
    await sheetsRequest(config, `/values/${encodeURIComponent(staleRange)}:clear`, {
      method: "POST",
      body: "{}",
    });
  }

  const statusValues = Object.values(STATUS_LABELS).map((value) => ({ userEnteredValue: value }));
  const jobTypeValues = Object.values(JOB_TYPE_LABELS).map((value) => ({ userEnteredValue: value }));
  await sheetsRequest(config, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId: metadata.sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId: metadata.sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: COLUMN_COUNT,
            },
            cell: {
              userEnteredFormat: {
                backgroundColorStyle: { rgbColor: { red: 0.9, green: 0.9, blue: 0.9 } },
                textFormat: { bold: true },
              },
            },
            fields: "userEnteredFormat(backgroundColorStyle,textFormat.bold)",
          },
        },
        {
          setDataValidation: {
            range: {
              sheetId: metadata.sheetId,
              startRowIndex: 1,
              endRowIndex: metadata.rowCount,
              startColumnIndex: 1,
              endColumnIndex: 2,
            },
            rule: {
              condition: { type: "ONE_OF_LIST", values: jobTypeValues },
              strict: true,
              showCustomUi: true,
            },
          },
        },
        {
          setDataValidation: {
            range: {
              sheetId: metadata.sheetId,
              startRowIndex: 1,
              endRowIndex: metadata.rowCount,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
          },
        },
        {
          setDataValidation: {
            range: {
              sheetId: metadata.sheetId,
              startRowIndex: 1,
              endRowIndex: metadata.rowCount,
              startColumnIndex: 4,
              endColumnIndex: 5,
            },
            rule: {
              condition: { type: "ONE_OF_LIST", values: statusValues },
              strict: true,
              showCustomUi: true,
            },
          },
        },
        {
          setBasicFilter: {
            filter: {
              range: {
                sheetId: metadata.sheetId,
                startRowIndex: 0,
                endRowIndex: metadata.rowCount,
                startColumnIndex: 0,
                endColumnIndex: COLUMN_COUNT,
              },
            },
          },
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: metadata.sheetId,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: COLUMN_COUNT,
            },
          },
        },
      ],
    }),
  });
}

async function saveLastSync(result: GoogleSheetsSyncResult): Promise<void> {
  await db
    .insert(tables.appSettings)
    .values({ key: LAST_SYNC_KEY, value: JSON.stringify(result), updatedAt: now() })
    .onConflictDoUpdate({
      target: tables.appSettings.key,
      set: { value: JSON.stringify(result), updatedAt: now() },
    });
}

export async function syncApplicationsToGoogleSheets(): Promise<GoogleSheetsSyncResult> {
  const config = loadConfig();
  if (!config) {
    return {
      status: "disabled",
      rows: 0,
      syncedAt: null,
      message: "Google Sheets sync is not configured",
    };
  }

  const applications = await db.select().from(tables.applications).orderBy(desc(tables.applications.updatedAt));
  const metadata = await sheetMetadata(config);
  await writeSheet(config, buildApplicationSheetRows(applications, config.defaultApplicationEmail), metadata);
  return {
    status: "synced",
    rows: applications.length,
    syncedAt: now(),
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`,
  };
}

async function runSafeSync(trigger: string): Promise<GoogleSheetsSyncResult> {
  let result: GoogleSheetsSyncResult;
  try {
    result = await syncApplicationsToGoogleSheets();
  } catch (error) {
    result = {
      status: "failed",
      rows: 0,
      syncedAt: now(),
      message: error instanceof Error ? error.message : "Unknown Google Sheets sync error",
    };
    console.error(`Google Sheets sync failed (${trigger}):`, result.message);
  }
  try {
    await saveLastSync(result);
  } catch (error) {
    console.error("Could not store Google Sheets sync status:", error instanceof Error ? error.message : error);
  }
  return result;
}

/** Queue full-sheet mirrors so concurrent application edits cannot publish stale ordering. */
export function syncApplicationsToGoogleSheetsSafe(trigger: string): Promise<GoogleSheetsSyncResult> {
  const next = syncQueue.then(() => runSafeSync(trigger), () => runSafeSync(trigger));
  syncQueue = next;
  return next;
}

export async function getGoogleSheetsIntegrationStatus(): Promise<GoogleSheetsIntegrationStatus> {
  const row = await db.query.appSettings.findFirst({ where: eq(tables.appSettings.key, LAST_SYNC_KEY) });
  let lastSync: GoogleSheetsSyncResult | null = null;
  try {
    lastSync = row ? (JSON.parse(row.value) as GoogleSheetsSyncResult) : null;
  } catch {
    lastSync = null;
  }
  return {
    configured: isGoogleSheetsConfigured(),
    spreadsheetId: configValue("GOOGLE_SHEETS_SPREADSHEET_ID") || null,
    sheetTab: configValue("GOOGLE_SHEETS_TAB") || null,
    lastSync,
  };
}
