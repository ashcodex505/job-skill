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

// ── Eightfold (public search API behind many corporate career sites) ──
/**
 * https://{host}/api/apply/v2/jobs?domain={domain}&query=…&start=…&num=…
 * No auth. Netflix (explore.jobs.netflix.net) confirmed working; the page
 * size is fixed at 10 regardless of the requested `num`, so pagination is a
 * `start` loop, capped like the other paginated adapters. Query text like
 * "software engineer intern" does a loose full-text match (returns some
 * senior titles too) — classifyTitle does the real filtering, same as every
 * other adapter.
 */
interface EightfoldJob {
  id: number;
  name: string;
  location: string;
  t_create?: number; // epoch seconds
  canonicalPositionUrl: string;
}

const EIGHTFOLD_QUERIES = ["software engineer intern", "software engineer new grad", "software engineer early career"];
const EIGHTFOLD_PAGE_SIZE = 10;
const EIGHTFOLD_MAX_PAGES = 5; // 50 results per query, per company — stays polite

async function scrapeEightfold(portal: CompanyPortal): Promise<RawJob[]> {
  const ef = portal.eightfold;
  if (!ef) throw new Error("Missing eightfold config");
  const byId = new Map<string, RawJob>();
  for (const query of EIGHTFOLD_QUERIES) {
    for (let page = 0; page < EIGHTFOLD_MAX_PAGES; page++) {
      const start = page * EIGHTFOLD_PAGE_SIZE;
      const data = await fetchJson<{ count: number; positions: EightfoldJob[] }>(
        `https://${ef.host}/api/apply/v2/jobs?domain=${encodeURIComponent(ef.domain)}&start=${start}&num=${EIGHTFOLD_PAGE_SIZE}&query=${encodeURIComponent(query)}`,
      );
      const positions = data.positions ?? [];
      for (const p of positions) {
        const sourceId = String(p.id);
        if (byId.has(sourceId)) continue;
        byId.set(sourceId, {
          source: "eightfold",
          sourceId,
          company: portal.name,
          title: p.name,
          location: p.location ?? null,
          url: p.canonicalPositionUrl,
          postedAt: p.t_create ? new Date(p.t_create * 1000).toISOString() : null,
          description: null,
        });
      }
      if (positions.length < EIGHTFOLD_PAGE_SIZE || start + EIGHTFOLD_PAGE_SIZE >= data.count) break;
      await sleep(300);
    }
    await sleep(300);
  }
  return [...byId.values()];
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

/**
 * Workday exposes posting age only as display text ("Posted Today",
 * "Posted Yesterday", "Posted 9 Days Ago", "Posted 30+ Days Ago").
 * Day precision only, so emit a date-only string; "30+" is an unbounded
 * floor, not a date — treat it as unknown rather than inventing one.
 */
export function parseWorkdayPostedOn(postedOn: string | undefined, now: Date = new Date()): string | null {
  if (!postedOn) return null;
  const text = postedOn.trim().toLowerCase();
  let days: number | null = null;
  if (/posted today/.test(text)) days = 0;
  else if (/posted yesterday/.test(text)) days = 1;
  else {
    const m = text.match(/posted (\d+)\+? days? ago/);
    if (m) {
      if (text.includes("+")) return null;
      days = Number(m[1]);
    }
  }
  if (days === null) return null;
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
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
          postedAt: parseWorkdayPostedOn(j.postedOn),
          description: null,
        });
      }
      if (page.length < limit || offset + limit >= (data.total ?? 0)) break;
      await sleep(500);
    }
  }
  return jobs;
}

// ── Amazon (amazon.jobs' own public search API) ────────────────────────
/**
 * Not in the CompanyPortal slug model — this is Amazon's own site search
 * backend (https://www.amazon.jobs/en/search.json), publicly reachable with
 * no auth, the same endpoint the careers site itself calls. Amazon's
 * "university_job"/"is_intern" flags are unreliable on this public endpoint,
 * so — like the Workday adapter — we search with a small set of targeted
 * queries and let classifyTitle do the real intern/new-grad/SWE filtering.
 */
interface AmazonJob {
  id_icims?: number;
  id: string;
  title: string;
  normalized_location?: string;
  location?: string;
  country_code?: string;
  job_path: string;
  posted_date?: string; // "May 13, 2026"
  description_short?: string;
}

const AMAZON_QUERIES = [
  "software engineer intern",
  "software development engineer intern",
  "software development engineer new grad",
  "software development engineer university",
];
const AMAZON_RESULT_LIMIT = 100;

function parseAmazonPostedDate(value: string | undefined): string | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

export async function scrapeAmazon(): Promise<RawJob[]> {
  const byId = new Map<string, RawJob>();
  for (const query of AMAZON_QUERIES) {
    const data = await fetchJson<{ hits: number; jobs: AmazonJob[] }>(
      `https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(query)}&result_limit=${AMAZON_RESULT_LIMIT}&sort=recent&offset=0`,
    );
    for (const j of data.jobs ?? []) {
      const sourceId = String(j.id_icims ?? j.id);
      if (byId.has(sourceId)) continue;
      byId.set(sourceId, {
        source: "amazon",
        sourceId,
        company: "Amazon",
        title: j.title,
        location: j.normalized_location ?? j.location ?? null,
        url: `https://www.amazon.jobs${j.job_path}`,
        postedAt: parseAmazonPostedDate(j.posted_date),
        description: j.description_short ?? null,
      });
    }
    await sleep(300);
  }
  return [...byId.values()];
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

// ── speedyapply community boards (MIT-licensed markdown tables) ───────
/**
 * speedyapply/2027-SWE-College-Jobs publishes no JSON, only generated
 * markdown tables:
 *   | <a href="site"><strong>Company</strong></a> | Title | Location |
 *   | Salary | <a href="applyUrl">…</a> | 8d |
 * The trailing "Age" column is day-precision, so postedAt is emitted as a
 * date-only string — the alert renderer already labels those
 * "time unavailable" instead of faking a clock time.
 */
const SPEEDYAPPLY_FILES = [
  { path: "README.md" }, // 2027 USA internships
  { path: "NEW_GRAD_USA.md" },
];
const SPEEDYAPPLY_REPO = "speedyapply/2027-SWE-College-Jobs";

// Intern tables have a Salary column, new-grad tables don't — the cell
// between Location and the Posting link is optional ([^|<]* keeps it from
// swallowing the <a> of the Posting cell).
const SPEEDY_ROW =
  /^\|\s*<a href="[^"]*"><strong>([^<]+)<\/strong><\/a>\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|(?:\s*[^|<]*\|)?\s*<a href="([^"]+)"[^|]*\|\s*(\d+)(d|h|mo)\s*\|/;

export function parseSpeedyApplyMarkdown(markdown: string, now: Date = new Date()): RawJob[] {
  const jobs: RawJob[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(SPEEDY_ROW);
    if (!m) continue;
    const [, company, title, location, url, ageNum, ageUnit] = m;
    const ageMs =
      Number(ageNum) * (ageUnit === "h" ? 3_600_000 : ageUnit === "mo" ? 30 * 86_400_000 : 86_400_000);
    jobs.push({
      source: "speedyapply",
      sourceId: null, // no stable provider id; dedupe key falls back to the URL
      company: company.trim(),
      title: title.trim(),
      location: location.trim() || null,
      url: url.trim(),
      postedAt: new Date(now.getTime() - ageMs).toISOString().slice(0, 10),
      description: null,
    });
  }
  return jobs;
}

export async function scrapeSpeedyApplyFeeds(now: Date = new Date()): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  let anyResolved = false;
  for (const file of SPEEDYAPPLY_FILES) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${SPEEDYAPPLY_REPO}/main/${file.path}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      jobs.push(...parseSpeedyApplyMarkdown(await res.text(), now));
      anyResolved = true;
    } catch {
      // One file failing (renamed/moved) shouldn't kill the other.
    }
    await sleep(300);
  }
  if (!anyResolved) throw new Error("speedyapply feed unavailable (all files failed)");
  return jobs;
}

export const ADAPTERS: Record<string, (portal: CompanyPortal) => Promise<RawJob[]>> = {
  greenhouse: scrapeGreenhouse,
  lever: scrapeLever,
  ashby: scrapeAshby,
  workday: scrapeWorkday,
  smartrecruiters: scrapeSmartRecruiters,
  workable: scrapeWorkable,
  amazon: scrapeAmazon, // takes no portal-specific config; see scrapeAmazon
  eightfold: scrapeEightfold,
};
