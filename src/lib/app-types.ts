/** Client-side view models returned by the API routes. */

export interface ApplicationRow {
  id: string;
  companyId: string | null;
  companyName: string;
  jobTitle: string;
  jobType: string;
  season: string | null;
  location: string | null;
  workMode: string;
  jobUrl: string | null;
  portalUrl: string | null;
  dateApplied: string | null;
  status: string;
  resumeId: string | null;
  coverLetterId: string | null;
  notes: string | null;
  tags: string[];
  nextActionDate: string | null;
  nextActionNote: string | null;
  discoveredJobId: string | null;
  createdAt: string;
  updatedAt: string;
  hasCredential?: boolean;
}

export interface StatusEvent {
  id: string;
  applicationId: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
}

export interface CredentialView {
  id: string;
  applicationId: string;
  email: string | null;
  username: string | null;
  hasPassword: boolean;
  hasSecureNotes: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeRow {
  id: string;
  name: string;
  versionLabel: string;
  targetRole: string | null;
  storageKey: string | null;
  storageDriver: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  notes: string | null;
  tags: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationDetail extends ApplicationRow {
  events: StatusEvent[];
  credential: CredentialView | null;
  resume: ResumeRow | null;
  coverLetter: ResumeRow | null;
  /** Scraped posting description when saved from Job Discovery. */
  jobDescription: string | null;
}

export interface DiscoveredJob {
  id: string;
  source: string;
  company: string;
  title: string;
  location: string | null;
  url: string;
  season: string | null;
  roleType: string;
  score: number;
  matchedSkills: string[];
  scoreBreakdown: {
    role: number;
    roleType: number;
    season: number;
    location: number;
    keywords: number;
    skills: number;
  } | null;
  description: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
  savedApplicationId: string | null;
  isNew: boolean;
}

export interface ScraperRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  companiesScanned: number;
  jobsFound: number;
  newJobs: number;
  errors: { company: string; message: string }[];
}

export interface VaultStatus {
  mode: "keychain" | "master";
  unlocked: boolean;
}
