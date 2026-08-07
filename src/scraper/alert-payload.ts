import { createHash } from "node:crypto";
import { canonicalUrl } from "./normalize";
import type { BoardJob } from "./board";

export type AlertType = "urgent" | "bigtech";

export interface AlertPayloadEntry {
  type: AlertType;
  fingerprint: string;
  observedAt: string;
  jobs: BoardJob[];
}

export type AlertPayload = Partial<Record<AlertType, AlertPayloadEntry>>;

export function createAlertFingerprint(type: AlertType, jobs: BoardJob[]): string {
  const identity = jobs.map((job) => canonicalUrl(job.url)).sort().join("\n");
  return createHash("sha256").update(`${type}\n${identity}`).digest("hex").slice(0, 24);
}

export function createAlertPayloadEntry(type: AlertType, jobs: BoardJob[], observedAt: string): AlertPayloadEntry {
  return { type, fingerprint: createAlertFingerprint(type, jobs), observedAt, jobs };
}

export function alertMarker(fingerprint: string): string {
  return `<!-- job-alert:${fingerprint} -->`;
}
