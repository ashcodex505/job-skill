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

export const ADAPTERS: Record<string, (portal: CompanyPortal) => Promise<RawJob[]>> = {
  greenhouse: scrapeGreenhouse,
  lever: scrapeLever,
  ashby: scrapeAshby,
  workday: scrapeWorkday,
};
