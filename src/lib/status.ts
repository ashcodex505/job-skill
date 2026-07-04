import { ACTIVE_STATUSES, APPLICATION_STATUSES, type ApplicationStatus, TERMINAL_STATUSES } from "./types";

export function isValidStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export function isActiveStatus(status: ApplicationStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function isTerminalStatus(status: ApplicationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Any status may move to any other status (real processes skip steps, get
 * rejected at any point, or get revived), except a no-op transition to the
 * same status, which would pollute the timeline.
 */
export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return isValidStatus(to) && from !== to;
}

/** Ordered pipeline for the Kanban board. */
export const PIPELINE_ORDER: ApplicationStatus[] = [
  "interested",
  "applied",
  "oa_received",
  "oa_completed",
  "recruiter_screen",
  "technical_interview",
  "final_round",
  "offer",
  "rejected",
  "withdrawn",
];
