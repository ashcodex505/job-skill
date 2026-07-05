import type { CompanyPortal } from "./registry";
import type { RawJob } from "./normalize";

/**
 * ATS adapters. Each hits an official public jobs API (no auth, no CAPTCHA,
 * no scraping of rendered HTML) and maps the response to RawJob[].
 * All requests share one polite fetch with a timeout and an identifying UA.
 */

const USER_AGENT = "resume-tracker/1.0 (personal job tracker; contact: local user)";
const TIMEOUT_MS = 20_000;

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init?.headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── Greenhouse ────────────────────────────────────────────────────────
interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string };
  offices?: { name?: string }[];
  /** HTML job description (present with ?content=true). */
  content?: string;
}

async function scrapeGreenhouse(portal: CompanyPortal): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${portal.slug}/jobs?content=true`,
  );
  return (data.jobs ?? []).map((j) => ({
    source: "greenhouse" as const,
    sourceId: String(j.id),
    company: portal.name,
    title: j.title,
    location: j.location?.name ?? j.offices?.map((o) => o.name).filter(Boolean).join("; ") ?? null,
    url: j.absolute_url,
    postedAt: j.updated_at ?? null,
    description: j.content ?? null,
  }));
}

// ── Lever ─────────────────────────────────────────────────────────────
interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: { location?: string; allLocations?: string[] };
  descriptionPlain?: string;
}

async function scrapeLever(portal: CompanyPortal): Promise<RawJob[]> {
  const data = await fetchJson<LeverJob[]>(`https://api.lever.co/v0/postings/${portal.slug}?mode=json`);
  return (data ?? []).map((j) => ({
    source: "lever" as const,
    sourceId: j.id,
    company: portal.name,
    title: j.text,
    location: j.categories?.allLocations?.join("; ") ?? j.categories?.location ?? null,
    url: j.hostedUrl,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    description: j.descriptionPlain ?? null,
  }));
}

// ── Ashby ─────────────────────────────────────────────────────────────
interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  publishedAt?: string;
  location?: string;
  secondaryLocations?: { location: string }[];
  descriptionHtml?: string;
}

async function scrapeAshby(portal: CompanyPortal): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${portal.slug}`,
  );
  return (data.jobs ?? []).map((j) => ({
    source: "ashby" as const,
    sourceId: j.id,
    company: portal.name,
    title: j.title,
    location:
      [j.location, ...(j.secondaryLocations?.map((l) => l.location) ?? [])].filter(Boolean).join("; ") || null,
    url: j.jobUrl,
    postedAt: j.publishedAt ?? null,
    description: j.descriptionHtml ?? null,
  }));
}

// ── SmartRecruiters (official public postings API) ────────────────────
interface SmartRecruitersPosting {
  id: string;
  name: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
  company?: { identifier?: string };
}

async function scrapeSmartRecruiters(portal: CompanyPortal): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const limit = 100;
  // Capped at 5 pages (500 postings) to stay polite on giant boards.
  for (let offset = 0; offset < 500; offset += limit) {
    const data = await fetchJson<{ totalFound: number; content: SmartRecruitersPosting[] }>(
      `https://api.smartrecruiters.com/v1/companies/${portal.slug}/postings?limit=${limit}&offset=${offset}`,
    );
    const page = data.content ?? [];
    for (const p of page) {
      const locationParts = [p.location?.city, p.location?.region, p.location?.country].filter(Boolean);
      jobs.push({
        source: "smartrecruiters",
        sourceId: p.id,
        company: portal.name,
        title: p.name,
        location: p.location?.remote ? `Remote${locationParts.length ? ` (${locationParts.join(", ")})` : ""}` : locationParts.join(", ") || null,
        url: `https://jobs.smartrecruiters.com/${p.company?.identifier ?? portal.slug}/${p.id}`,
        postedAt: p.releasedDate ?? null,
        description: null, // list API has no JD; per-posting fetches would be 100s of extra requests
      });
    }
    if (page.length < limit || offset + limit >= data.totalFound) break;
    await sleep(300);
  }
  return jobs;
}

// ── Workable (official public widget API) ─────────────────────────────
interface WorkableJob {
  title: string;
  shortcode: string;
  url: string;
  published_on?: string;
  telecommuting?: boolean;
  city?: string;
  state?: string;
  country?: string;
}

async function scrapeWorkable(portal: CompanyPortal): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs: WorkableJob[] }>(
    `https://apply.workable.com/api/v1/widget/accounts/${portal.slug}`,
  );
  return (data.jobs ?? []).map((j) => {
    const locationParts = [j.city, j.state, j.country].filter(Boolean);
    return {
      source: "workable" as const,
      sourceId: j.shortcode,
      company: portal.name,
      title: j.title,
      location: j.telecommuting ? `Remote${locationParts.length ? ` (${locationParts.join(", ")})` : ""}` : locationParts.join(", ") || null,
      url: j.url,
      postedAt: j.published_on ?? null,
      description: null,
    };
  });
}

// ── Workday (career-site JSON endpoint) ───────────────────────────────
interface WorkdayJob {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

async function scrapeWorkday(portal: CompanyPortal): Promise<RawJob[]> {
  const wd = portal.workday;
  if (!wd) throw new Error("Missing workday config");
  const base = `https://${wd.host}/wday/cxs/${wd.tenant}/${wd.site}`;
  const jobs: RawJob[] = [];
  const limit = 20;
  // Search-scoped and capped at 5 pages to stay polite.
  for (const searchText of ["intern", "new grad"]) {
    for (let offset = 0; offset < 100; offset += limit) {
      const data = await fetchJson<{ jobPostings?: WorkdayJob[]; total?: number }>(`${base}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText }),
      });
      const page = data.jobPostings ?? [];
      for (const j of page) {
        jobs.push({
          source: "workday",
          sourceId: j.bulletFields?.[0] ?? j.externalPath,
          company: portal.name,
          title: j.title,
          location: j.locationsText ?? null,
          url: `https://${wd.host}/en-US/${wd.site}${j.externalPath.replace(/^.*?(?=\/job\/)/, "")}`,
          postedAt: null,
          description: null,
        });
      }
      if (page.length < limit || offset + limit >= (data.total ?? 0)) break;
      await sleep(500);
    }
  }
  return jobs;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── SimplifyJobs community feed (MIT-licensed listings.json) ──────────
/**
 * Not a per-company adapter: the SimplifyJobs repos aggregate early-career
 * roles across hundreds of companies — including the anti-bot portals we
 * refuse to scrape (Google, Amazon, Meta, …) — with true posted dates.
 * We read the raw listings.json the maintainers publish; repo names roll
 * over per season, so candidates are tried in order until one resolves.
 */
interface SimplifyListing {
  id: string;
  company_name: string;
  title: string;
  locations?: string[];
  url: string;
  date_posted?: number; // epoch seconds
  active?: boolean;
  is_visible?: boolean;
}

const SIMPLIFY_FEEDS: { repo: string; branches: string[] }[] = [
  { repo: "SimplifyJobs/New-Grad-Positions", branches: ["dev", "main"] },
  { repo: "SimplifyJobs/Summer2027-Internships", branches: ["dev", "main"] },
  { repo: "SimplifyJobs/Summer2026-Internships", branches: ["dev", "main"] },
];

/** Skip stale listings the accumulating repos never prune. */
const SIMPLIFY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export async function scrapeSimplifyFeeds(now: Date = new Date()): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  let anyResolved = false;

  for (const feed of SIMPLIFY_FEEDS) {
    let listings: SimplifyListing[] | null = null;
    for (const branch of feed.branches) {
      try {
        listings = await fetchJson<SimplifyListing[]>(
          `https://raw.githubusercontent.com/${feed.repo}/${branch}/.github/scripts/listings.json`,
        );
        break;
      } catch {
        // Try the next branch / feed; a season repo may not exist yet.
      }
    }
    if (!listings) continue;
    anyResolved = true;

    for (const l of listings) {
      if (!l.active || !l.is_visible || !l.url || !l.id || seen.has(l.id)) continue;
      const postedMs = (l.date_posted ?? 0) * 1000;
      if (!postedMs || now.getTime() - postedMs > SIMPLIFY_MAX_AGE_MS) continue;
      seen.add(l.id);
      jobs.push({
        source: "simplifyjobs",
        sourceId: l.id,
        company: l.company_name,
        title: l.title,
        location: l.locations?.filter(Boolean).join("; ") || null,
        url: l.url,
        postedAt: new Date(postedMs).toISOString(),
        description: null,
      });
    }
    await sleep(300);
  }

  if (!anyResolved) throw new Error("No SimplifyJobs feed resolved (all candidate repos/branches failed)");
  return jobs;
}

export const ADAPTERS: Record<string, (portal: CompanyPortal) => Promise<RawJob[]>> = {
  greenhouse: scrapeGreenhouse,
  lever: scrapeLever,
  ashby: scrapeAshby,
  workday: scrapeWorkday,
  smartrecruiters: scrapeSmartRecruiters,
  workable: scrapeWorkable,
};
