export const APPLICATION_STATUSES = [
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
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  interested: "Interested",
  applied: "Applied",
  oa_received: "OA Received",
  oa_completed: "OA Completed",
  recruiter_screen: "Recruiter Screen",
  technical_interview: "Technical Interview",
  final_round: "Final Round",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** Statuses that count as a live, in-flight process. */
export const ACTIVE_STATUSES: ApplicationStatus[] = [
  "applied",
  "oa_received",
  "oa_completed",
  "recruiter_screen",
  "technical_interview",
  "final_round",
];

/** Statuses that count as being in the interview stage. */
export const INTERVIEW_STATUSES: ApplicationStatus[] = [
  "recruiter_screen",
  "technical_interview",
  "final_round",
];

export const TERMINAL_STATUSES: ApplicationStatus[] = ["offer", "rejected", "withdrawn"];

export const JOB_TYPES = ["new_grad", "internship", "full_time", "other"] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  new_grad: "New Grad",
  internship: "Internship",
  full_time: "Full-time",
  other: "Other",
};

export const WORK_MODES = ["remote", "hybrid", "onsite", "unknown"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const ROLE_TYPES = ["internship", "new_grad", "unknown"] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

export const SEASON_PRESETS = [
  "Summer 2027",
  "Fall 2026",
  "Winter 2027",
  "Spring 2027",
  "2027 New Grad",
  "2026 New Grad",
  "Ongoing",
];
