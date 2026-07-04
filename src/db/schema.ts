import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** ISO-8601 timestamp stored as TEXT for readability in SQLite. */
const timestamp = (name: string) => text(name);

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    website: text("website"),
    careersUrl: text("careers_url"),
    /** ATS provider: greenhouse | lever | ashby | workday | custom | unknown */
    ats: text("ats"),
    /** Provider-specific board slug/tenant config (JSON). */
    atsConfig: text("ats_config"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [uniqueIndex("companies_name_unique").on(t.name)],
);

export const resumes = sqliteTable("resumes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  versionLabel: text("version_label").notNull().default("v1"),
  targetRole: text("target_role"),
  /** Object key within the configured storage driver. Null until a file is uploaded. */
  storageKey: text("storage_key"),
  /** Driver the file was written with: local | supabase */
  storageDriver: text("storage_driver"),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  notes: text("notes"),
  /** JSON array of strings. */
  tags: text("tags").notNull().default("[]"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").references(() => companies.id),
    companyName: text("company_name").notNull(),
    jobTitle: text("job_title").notNull(),
    /** new_grad | internship | full_time | other */
    jobType: text("job_type").notNull().default("new_grad"),
    /** Free-form target cycle, e.g. "Summer 2027", "2027 New Grad". */
    season: text("season"),
    location: text("location"),
    /** remote | hybrid | onsite | unknown */
    workMode: text("work_mode").notNull().default("unknown"),
    jobUrl: text("job_url"),
    portalUrl: text("portal_url"),
    dateApplied: text("date_applied"),
    status: text("status").notNull().default("interested"),
    resumeId: text("resume_id").references(() => resumes.id),
    coverLetterId: text("cover_letter_id").references(() => resumes.id),
    notes: text("notes"),
    /** JSON array of strings. */
    tags: text("tags").notNull().default("[]"),
    nextActionDate: text("next_action_date"),
    nextActionNote: text("next_action_note"),
    discoveredJobId: text("discovered_job_id"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [index("applications_status_idx").on(t.status), index("applications_company_idx").on(t.companyName)],
);

/**
 * Credentials are local-only. There is intentionally no plaintext password
 * column: passwords (and optional secure notes) are AES-256-GCM ciphertext
 * produced by src/lib/security. Emails/usernames stay plaintext for
 * searchability (documented trade-off in docs/security.md).
 */
export const credentials = sqliteTable(
  "credentials",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    email: text("email"),
    username: text("username"),
    /** hex(ciphertext || gcmAuthTag) */
    encryptedPassword: text("encrypted_password"),
    encryptionIv: text("encryption_iv"),
    /** Per-record KDF salt (empty string when the key comes from Keychain). */
    encryptionSalt: text("encryption_salt"),
    /** 1 = keychain-managed random key, 2 = scrypt(master password). */
    encryptionVersion: integer("encryption_version"),
    encryptedNotes: text("encrypted_notes"),
    notesIv: text("notes_iv"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("credentials_application_unique").on(t.applicationId)],
);

export const statusEvents = sqliteTable(
  "status_events",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("status_events_application_idx").on(t.applicationId)],
);

export const discoveredJobs = sqliteTable(
  "discovered_jobs",
  {
    id: text("id").primaryKey(),
    /** greenhouse | lever | ashby | workday | manual */
    source: text("source").notNull(),
    /** Provider job id when available. */
    sourceId: text("source_id"),
    /** Stable dedupe key: source:sourceId, or a content hash fallback. */
    dedupeKey: text("dedupe_key").notNull(),
    company: text("company").notNull(),
    companyId: text("company_id").references(() => companies.id),
    title: text("title").notNull(),
    location: text("location"),
    url: text("url").notNull(),
    /** Detected cycle, e.g. "Summer 2027". */
    season: text("season"),
    /** internship | new_grad | unknown */
    roleType: text("role_type").notNull().default("unknown"),
    /** 0-100 relevance score from the classifier (+ career-profile skill match). */
    score: integer("score").notNull().default(0),
    /** JSON array: skills from career/profile.md found in the posting. */
    matchedSkills: text("matched_skills").notNull().default("[]"),
    postedAt: text("posted_at"),
    firstSeenAt: timestamp("first_seen_at").notNull(),
    lastSeenAt: timestamp("last_seen_at").notNull(),
    /** Still present in the source feed as of the last scrape. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    savedApplicationId: text("saved_application_id"),
  },
  (t) => [
    uniqueIndex("discovered_jobs_dedupe_unique").on(t.dedupeKey),
    index("discovered_jobs_company_idx").on(t.company),
    index("discovered_jobs_seen_idx").on(t.firstSeenAt),
  ],
);

export const scraperRuns = sqliteTable("scraper_runs", {
  id: text("id").primaryKey(),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  /** running | completed | failed */
  status: text("status").notNull().default("running"),
  companiesScanned: integer("companies_scanned").notNull().default(0),
  jobsFound: integer("jobs_found").notNull().default(0),
  newJobs: integer("new_jobs").notNull().default(0),
  /** JSON array of { company, message }. */
  errors: text("errors").notNull().default("[]"),
});

/** Small key/value store (e.g. encryption verifier, last-viewed markers). */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
