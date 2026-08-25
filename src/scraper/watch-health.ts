import { createHash } from "node:crypto";

export interface WatchHealthState {
  // Kept for compatibility with the committed state created by the former
  // separate priority job. It now records every successful scheduled watch.
  lastSuccessfulPriorityScanAt: string | null;
}

export interface RecoveryGap {
  previousSuccessfulAt: string;
  recoveredAt: string;
  gapMinutes: number;
  fingerprint: string;
}

export const RECOVERY_GAP_THRESHOLD_MINUTES = 90;

export function detectRecoveryGap(state: WatchHealthState | null, recoveredAt: string): RecoveryGap | null {
  const previous = state?.lastSuccessfulPriorityScanAt;
  if (!previous) return null;
  const gapMinutes = Math.floor((new Date(recoveredAt).getTime() - new Date(previous).getTime()) / 60_000);
  if (!Number.isFinite(gapMinutes) || gapMinutes <= RECOVERY_GAP_THRESHOLD_MINUTES) return null;
  const fingerprint = createHash("sha256").update(previous).digest("hex").slice(0, 24);
  return { previousSuccessfulAt: previous, recoveredAt, gapMinutes, fingerprint };
}
