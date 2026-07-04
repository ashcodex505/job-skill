import { z } from "zod";
import { APPLICATION_STATUSES, JOB_TYPES, WORK_MODES } from "./types";

const optionalTrimmed = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const optionalUrl = z
  .string()
  .trim()
  .url()
  .max(2000)
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

export const applicationInput = z.object({
  companyName: z.string().trim().min(1, "Company is required").max(200),
  jobTitle: z.string().trim().min(1, "Job title is required").max(300),
  jobType: z.enum(JOB_TYPES).default("new_grad"),
  season: optionalTrimmed,
  location: optionalTrimmed,
  workMode: z.enum(WORK_MODES).default("unknown"),
  jobUrl: optionalUrl,
  portalUrl: optionalUrl,
  dateApplied: isoDate,
  status: z.enum(APPLICATION_STATUSES).default("interested"),
  resumeId: optionalTrimmed,
  coverLetterId: optionalTrimmed,
  notes: z.string().trim().max(20000).optional().nullable().transform((v) => (v ? v : null)),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  nextActionDate: isoDate,
  nextActionNote: optionalTrimmed,
  discoveredJobId: optionalTrimmed,
});
export type ApplicationInput = z.infer<typeof applicationInput>;

export const statusUpdateInput = z.object({
  status: z.enum(APPLICATION_STATUSES),
  note: z.string().trim().max(5000).optional().nullable().transform((v) => (v ? v : null)),
});

export const resumeInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  versionLabel: z.string().trim().min(1).max(100).default("v1"),
  targetRole: optionalTrimmed,
  notes: z.string().trim().max(20000).optional().nullable().transform((v) => (v ? v : null)),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  archived: z.boolean().default(false),
});
export type ResumeInput = z.infer<typeof resumeInput>;

export const credentialInput = z.object({
  email: z.string().trim().email().max(320).optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
  username: optionalTrimmed,
  /** Plaintext over the local API only; encrypted before it touches disk. */
  password: z.string().max(1000).optional().nullable().transform((v) => (v ? v : null)),
  secureNotes: z.string().max(10000).optional().nullable().transform((v) => (v ? v : null)),
});
export type CredentialInput = z.infer<typeof credentialInput>;

export const unlockInput = z.object({
  masterPassword: z.string().min(8, "Master password must be at least 8 characters").max(1000),
});
