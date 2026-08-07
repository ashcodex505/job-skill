import type { CompanyPortal } from "./registry";
import type { RawJob } from "./normalize";

/**
 * ATS adapters. Each hits an official public jobs API (no auth, no CAPTCHA,
 * no scraping of rendered HTML) and maps the response to RawJob[].
 * All requests share one polite fetch with a timeout and an identifying UA.
 */

const USER_AGENT = "resume-tracker/1.0 (personal job tracker; contact: local user)";
/**
 * Browser-like fallback UA for hosts whose WAF/CDN bot management blocks the
 * default identifying UA outright (ported from career-ops' _http.mjs, which
 * hit this live against Workday and Oracle Cloud tenants). Adapters that see
 * persistent blocks with the default UA can opt into this per-request.
 */
export const BROWSER_LIKE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;

class FetchStatusError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter: string | null,
  ) {
    super(message);
    this.name = "FetchStatusError";
  }
}

/** Parses a `Retry-After` header value (seconds, or an HTTP-date) to ms, or null. */
function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

/** Timeout/abort or an HTTP 429/5xx — the symptoms of momentary throttling, not permanent breakage. */
function isRetryable(err: unknown): boolean {
  if (err instanceof FetchStatusError) return err.status === 429 || err.status >= 500;
  return err instanceof Error && err.name === "AbortError";
}

async function fetchOnce<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init?.headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new FetchStatusError(`HTTP ${res.status} from ${new URL(url).host}`, res.status, res.headers.get("retry-after"));
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retries transient failures — timeout/abort or HTTP 429/5xx — with
 * exponential backoff + jitter, honoring a `Retry-After` header when the
 * server sends one (ported from career-ops' provider retry pattern, most
 * visibly its oraclecloud.mjs and workday.mjs). A genuinely wrong slug
 * (404) is NEVER retried and fails immediately, so the registry's monthly
 * slug doctor still catches real breakage instead of it being masked.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchOnce<T>(url, init);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err;
      const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
      const retryAfterMs = err instanceof FetchStatusError ? parseRetryAfterMs(err.retryAfter) : null;
      const delayMs = retryAfterMs !== null ? Math.min(retryAfterMs, RETRY_MAX_DELAY_MS * 4) : backoff + Math.random() * 250;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

/** Same retry/backoff policy as fetchJson, for endpoints that return raw text (e.g. XML feeds). */
async function fetchTextOnce(url: string, init?: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, ...init?.headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new FetchStatusError(`HTTP ${res.status} from ${new URL(url).host}`, res.status, res.headers.get("retry-after"));
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchTextOnce(url, init);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err;
      const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
      const retryAfterMs = err instanceof FetchStatusError ? parseRetryAfterMs(err.retryAfter) : null;
      const delayMs = retryAfterMs !== null ? Math.min(retryAfterMs, RETRY_MAX_DELAY_MS * 4) : backoff + Math.random() * 250;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

// ── Greenhouse ────────────────────────────────────────────────────────
interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  /** True immutable posted date — unlike updated_at, never drifts forward on an edit. */
  first_published?: string;
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
    // first_published is the true posted date (confirmed live: Greenhouse's
    // own field, distinct from updated_at, which drifts forward on every
    // edit — first_published does not). Prefer it; fall back to updated_at
    // for the rare response missing it, still corrected downstream by
    // resolvePostedAt's earliest-known-date rule either way.
    postedAt: j.first_published ?? j.updated_at ?? null,
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

// ── Atlassian (first-party careers endpoint) ─────────────────────────
interface AtlassianJob {
  id: number;
  portalId?: number;
  title: string;
  locations?: string[];
  overview?: string;
  responsibilities?: string;
  qualifications?: string;
  portalJobPost?: { portalUrl?: string; updatedDate?: string };
}

export async function scrapeAtlassian(portal: CompanyPortal): Promise<RawJob[]> {
  const data = await fetchJson<AtlassianJob[]>("https://www.atlassian.com/endpoint/careers/listings");
  return (data ?? []).filter((job) => job.id && job.title?.trim()).map((job) => ({
    source: "atlassian" as const,
    sourceId: `${job.portalId ?? "unknown"}:${job.id}`,
    company: portal.name,
    title: job.title,
    location: job.locations?.join("; ") || null,
    url: `https://www.atlassian.com/company/careers/details/${job.id}`,
    postedAt: job.portalJobPost?.updatedDate ?? null,
    description: [job.overview, job.responsibilities, job.qualifications].filter(Boolean).join("\n") || null,
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

// ── BambooHR (public per-tenant careers list) ──────────────────────────
// Ported from career-ops' bamboohr.mjs. List endpoint only (zero extra
// requests) — no description, matching the "list API has no JD" tradeoff
// already made for SmartRecruiters/Workable/Eightfold in this file.
interface BambooHRJob {
  id: number | string;
  jobOpeningName?: string;
  isRemote?: number | boolean;
  location?: { city?: string; state?: string };
}

async function scrapeBambooHR(portal: CompanyPortal): Promise<RawJob[]> {
  const slug = portal.slug;
  if (!slug) throw new Error("Missing bamboohr slug");
  const origin = `https://${slug}.bamboohr.com`;
  const data = await fetchJson<{ result?: BambooHRJob[] }>(`${origin}/careers/list`);
  return (data.result ?? [])
    .filter((j) => j.jobOpeningName && String(j.id ?? "").trim().length > 0)
    .map((j) => {
      const loc = j.location ?? {};
      const remote = j.isRemote ? "Remote" : "";
      return {
        source: "bamboohr" as const,
        sourceId: String(j.id),
        company: portal.name,
        title: j.jobOpeningName ?? "",
        location: [loc.city, loc.state, remote].filter(Boolean).join(", ") || null,
        url: `${origin}/careers/${encodeURIComponent(String(j.id))}`,
        postedAt: null,
        description: null,
      };
    });
}

// ── Recruitee (public per-tenant offers API) ───────────────────────────
// Ported from career-ops' recruitee.mjs.
interface RecruiteeOffer {
  title?: string;
  careers_url?: string;
  url?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  location?: string;
}

async function scrapeRecruitee(portal: CompanyPortal): Promise<RawJob[]> {
  const slug = portal.slug;
  if (!slug) throw new Error("Missing recruitee slug");
  const data = await fetchJson<{ offers?: RecruiteeOffer[] }>(`https://${slug}.recruitee.com/api/offers/`);
  return (data.offers ?? [])
    .map((j) => {
      const remote = j.remote ? "Remote" : "";
      const location = j.location || [j.city, j.country, remote].filter(Boolean).join(", ");
      const rawUrl = j.careers_url || j.url || "";
      let url = "";
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "https:") url = parsed.href;
      } catch {
        /* malformed → dropped below */
      }
      return { title: j.title ?? "", url, location: location || null, company: portal.name };
    })
    .filter((j) => j.title && j.url)
    .map((j) => ({
      source: "recruitee" as const,
      sourceId: null,
      company: j.company,
      title: j.title,
      location: j.location,
      url: j.url,
      postedAt: null,
      description: null,
    }));
}

// ── Breezy HR (public per-tenant board feed) ───────────────────────────
// Ported from career-ops' breezy.mjs — the one of this batch that supplies
// postedAt for free in the list payload.
interface BreezyPosition {
  name?: string;
  url?: string;
  published_date?: string;
  location?: { name?: string; city?: string; state?: string; country?: { name?: string }; is_remote?: boolean };
}

async function scrapeBreezy(portal: CompanyPortal): Promise<RawJob[]> {
  const slug = portal.slug;
  if (!slug) throw new Error("Missing breezy slug");
  const data = await fetchJson<BreezyPosition[]>(`https://${slug}.breezy.hr/json`);
  const jobs: RawJob[] = [];
  for (const j of data ?? []) {
    if (!j.name) continue;
    let url = "";
    try {
      const parsed = new URL(j.url ?? "");
      if (parsed.protocol === "https:") url = parsed.href;
    } catch {
      /* malformed → drop */
    }
    if (!url) continue;
    const loc = j.location ?? {};
    const remote = loc.is_remote ? "Remote" : "";
    const assembled = [loc.city, loc.state, loc.country?.name].filter(Boolean).join(", ");
    const base = loc.name?.trim() || assembled;
    const location = remote && !/remote/i.test(base) ? [base, remote].filter(Boolean).join(", ") : base;
    const postedMs = j.published_date ? Date.parse(j.published_date) : NaN;
    jobs.push({
      source: "breezy",
      sourceId: null,
      company: portal.name,
      title: j.name,
      location: location || null,
      url,
      postedAt: Number.isNaN(postedMs) ? null : new Date(postedMs).toISOString(),
      description: null,
    });
  }
  return jobs;
}

// ── Rippling (public per-tenant ATS board API) ─────────────────────────
// Ported from career-ops' rippling.mjs. Careers host (ats.rippling.com) and
// API host (api.rippling.com) are both fixed; only the tenant slug varies.
interface RipplingJob {
  name?: string;
  url?: string;
  workLocation?: { label?: string } | string;
}

async function scrapeRippling(portal: CompanyPortal): Promise<RawJob[]> {
  const slug = portal.slug;
  if (!slug) throw new Error("Missing rippling slug");
  const data = await fetchJson<RipplingJob[]>(`https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(slug)}/jobs`);
  const jobs: RawJob[] = [];
  for (const j of data ?? []) {
    const title = j.name?.trim();
    if (!title) continue;
    let url = "";
    try {
      const parsed = new URL(j.url ?? "");
      // Rippling always serves postings on ats.rippling.com — an off-host URL is untrusted.
      if (parsed.protocol === "https:" && parsed.hostname === "ats.rippling.com") url = parsed.href;
    } catch {
      /* malformed → drop */
    }
    if (!url) continue;
    const wl = j.workLocation;
    const location = wl && typeof wl === "object" ? (wl.label?.trim() ?? "") : typeof wl === "string" ? wl.trim() : "";
    jobs.push({ source: "rippling", sourceId: null, company: portal.name, title, location: location || null, url, postedAt: null, description: null });
  }
  return jobs;
}

// ── Personio (public per-tenant XML feed) ──────────────────────────────
// Ported from career-ops' personio.mjs — parsed with a tiny in-process XML
// tag extractor rather than pulling in an XML dependency for one feed.
async function scrapePersonio(portal: CompanyPortal): Promise<RawJob[]> {
  const host = portal.personio?.host;
  if (!host) throw new Error("Missing personio host");
  const xml = await fetchText(`https://${host}/xml`);
  return parsePersonioXml(xml, portal.name, host);
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function personioTagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  const inner = m[1];
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return (cdata ? cdata[1] : decodeXmlEntities(inner)).trim();
}

/** Parses Personio's public `<workzag-jobs><position>...</position></workzag-jobs>` feed. Exported for tests. */
export function parsePersonioXml(xml: string, companyName: string, host: string): RawJob[] {
  if (typeof xml !== "string") return [];
  const jobs: RawJob[] = [];
  const stripped = xml.replace(/<jobDescriptions\b[^>]*>[\s\S]*?<\/jobDescriptions>/gi, "");
  const blocks = stripped.match(/<position\b[^>]*>[\s\S]*?<\/position>/g) ?? [];
  for (const block of blocks) {
    const title = personioTagText(block, "name");
    if (!title) continue;
    const id = personioTagText(block, "id");
    if (!/^\d+$/.test(id)) continue;
    const offices: string[] = [];
    const seen = new Set<string>();
    for (const om of block.matchAll(/<office\b[^>]*>([\s\S]*?)<\/office>/g)) {
      const cdata = om[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
      const name = (cdata ? cdata[1] : decodeXmlEntities(om[1])).trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        offices.push(name);
      }
    }
    const createdAt = personioTagText(block, "createdAt");
    const postedMs = createdAt ? Date.parse(createdAt) : NaN;
    jobs.push({
      source: "personio",
      sourceId: id,
      company: companyName,
      title,
      location: offices.join(", ") || null,
      url: `https://${host}/job/${id}`,
      postedAt: Number.isNaN(postedMs) ? null : new Date(postedMs).toISOString(),
      description: null,
    });
  }
  return jobs;
}

// ── Pinpoint (public per-tenant postings.json feed) ────────────────────
// Ported from career-ops' pinpoint.mjs.
interface PinpointPosting {
  title?: string;
  url?: string;
  location?: { name?: string; city?: string; province?: string };
}

async function scrapePinpoint(portal: CompanyPortal): Promise<RawJob[]> {
  const slug = portal.slug;
  if (!slug) throw new Error("Missing pinpoint slug");
  const data = await fetchJson<{ data?: PinpointPosting[] }>(`https://${slug}.pinpointhq.com/postings.json`);
  const jobs: RawJob[] = [];
  for (const j of data.data ?? []) {
    const title = j.title?.trim();
    if (!title) continue;
    let url = "";
    try {
      const parsed = new URL(j.url ?? "");
      if (parsed.protocol === "https:") url = parsed.href;
    } catch {
      /* malformed → drop */
    }
    if (!url) continue;
    const loc = j.location ?? {};
    const location = loc.name?.trim() || [loc.city, loc.province].filter(Boolean).join(", ");
    jobs.push({ source: "pinpoint", sourceId: null, company: portal.name, title, location: location || null, url, postedAt: null, description: null });
  }
  return jobs;
}

// ── Shopify (Pinpoint regular roles + official internship microsite) ──
// Shopify's Engineering & Data application drops do not appear in its
// otherwise healthy Pinpoint feed. The official internship microsite is the
// authoritative open/closed surface and links each application to a stable
// Ashby job id on shopify.com/careers.
const SHOPIFY_INTERNSHIPS_URL = "https://internships.shopify.com/";
const SHOPIFY_JOB_LINK_RE =
  /https:\/\/www\.shopify\.com\/careers\/([a-z0-9-]+)_([0-9a-f-]{36})(?:\?[^"'<>\s]*)?/gi;

const titleCaseSlug = (slug: string): string =>
  slug
    .split("-")
    .filter(Boolean)
    .map((word) => (word === "ai" ? "AI" : word === "ml" ? "ML" : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join(" ");

/** Parse only applications the official microsite explicitly says are open. */
export function parseShopifyInternshipsHtml(html: string, observedAt: Date = new Date()): RawJob[] {
  if (!/applications\s+are\s+open/i.test(html)) return [];

  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(SHOPIFY_JOB_LINK_RE)) {
    const [, slug, ashbyId] = match;
    if (seen.has(ashbyId)) continue;
    seen.add(ashbyId);
    jobs.push({
      source: "shopify",
      sourceId: ashbyId,
      company: "Shopify",
      title: titleCaseSlug(slug),
      // The program page explicitly lists US offices (Bellevue and New York
      // City) alongside Canadian offices. Retain both without letting the
      // US-only policy misclassify the combined application as foreign-only.
      location: "United States; Canada",
      url: `https://www.shopify.com/careers/${slug}_${ashbyId}`,
      // This timestamp describes the application opening we observed, not
      // Ashby's older underlying job-record creation date. Board merging keeps
      // the earliest observation stable across later scheduled scans.
      postedAt: observedAt.toISOString(),
      description: null,
    });
  }
  return jobs;
}

async function scrapeShopify(portal: CompanyPortal): Promise<RawJob[]> {
  const [regular, internshipHtml] = await Promise.all([
    scrapePinpoint({ ...portal, ats: "pinpoint" }),
    fetchText(SHOPIFY_INTERNSHIPS_URL, { headers: { Accept: "text/html" } }),
  ]);
  const internships = parseShopifyInternshipsHtml(internshipHtml);
  if (/applications\s+are\s+open/i.test(internshipHtml) && internships.length === 0) {
    throw new Error("Shopify says internship applications are open but no application links were parsed");
  }
  if (!/applications\s+are\s+(?:open|closed)/i.test(internshipHtml)) {
    throw new Error("Shopify internship application status could not be parsed");
  }
  return [...regular, ...internships];
}

// ── JibeApply (iCIMS-owned; /api/jobs endpoint, paginated) ─────────────
// Ported from career-ops' jibeapply.mjs.
interface JibeApplyJob {
  data?: { title?: string; slug?: string; req_id?: string; hiring_organization?: string; full_location?: string; city?: string; country?: string };
  title?: string;
  slug?: string;
  req_id?: string;
  hiring_organization?: string;
  full_location?: string;
  city?: string;
  country?: string;
}

const JIBEAPPLY_MAX_PAGES = 50; // 500 jobs — every known tenant paginates at 10/page

async function scrapeJibeApply(portal: CompanyPortal): Promise<RawJob[]> {
  const slug = portal.slug;
  if (!slug) throw new Error("Missing jibeapply slug");
  const origin = `https://${slug}.jibeapply.com`;
  const apiUrl = `${origin}/api/jobs`;
  const first = await fetchJson<{ jobs?: JibeApplyJob[]; totalCount?: number; count?: number }>(apiUrl);
  const total = first.totalCount ?? 0;
  const pageSize = first.jobs?.length || first.count || 10;
  const allItems = [...(first.jobs ?? [])];

  if (total > pageSize && pageSize > 0) {
    const pages = Math.min(Math.ceil(total / pageSize), JIBEAPPLY_MAX_PAGES);
    for (let page = 2; page <= pages; page++) {
      const u = new URL(apiUrl);
      u.searchParams.set("page", String(page));
      try {
        const json = await fetchJson<{ jobs?: JibeApplyJob[] }>(u.toString());
        allItems.push(...(json.jobs ?? []));
      } catch {
        break; // return what we've gathered rather than losing it to one bad page
      }
      await sleep(200);
    }
  }

  return allItems
    .map((item): RawJob | null => {
      const d = item.data ?? item;
      const title = (d.title ?? "").trim();
      const slugOrReq = d.slug ?? d.req_id;
      if (!title || !slugOrReq) return null;
      return {
        source: "jibeapply",
        sourceId: String(slugOrReq),
        company: (d.hiring_organization ?? portal.name).trim(),
        title,
        location: d.full_location || [d.city, d.country].filter(Boolean).join(", ") || null,
        url: `${origin}/jobs/${encodeURIComponent(String(slugOrReq))}`,
        postedAt: null,
        description: null,
      };
    })
    .filter((j): j is RawJob => j !== null);
}

// ── Oracle Recruiting Cloud (large-enterprise ATS: JPMorgan, BNY, Amex, …) ──
// Ported from career-ops' oraclecloud.mjs, including its documented "hasMore
// is unreliable, trust listLength/TotalJobsCount instead" fix (verified live
// against JPMC by career-ops: hasMore:false on every page despite 7,000+ jobs).
interface OracleRequisition {
  Id?: number | string;
  RequisitionNumber?: number | string;
  Title?: string;
  ExternalURL?: string;
  PrimaryLocation?: string;
  workLocation?: { TownOrCity?: string; Region?: string; Country?: string }[];
  WorkplaceTypeCode?: string;
  PostedDate?: string;
}

const ORACLE_PAGE_SIZE = 200;
const ORACLE_MAX_PAGES = 25; // ~5,000 jobs safety cap
const ORACLE_FACETS_LIST =
  "LOCATIONS%3BWORK_LOCATIONS%3BWORKPLACE_TYPES%3BTITLES%3BCATEGORIES%3BORGANIZATIONS%3BPOSTING_DATES%3BFLEX_FIELDS";

function buildOracleUrl(host: string, siteNumber: string, locationId: string | undefined, offset: number): string {
  const finderParams = [`siteNumber=${siteNumber}`, `facetsList=${ORACLE_FACETS_LIST}`, `limit=${ORACLE_PAGE_SIZE}`, "sortBy=POSTING_DATES_DESC", `offset=${offset}`];
  if (locationId) finderParams.push(`locationId=${locationId}`);
  const finder = `findReqs;${finderParams.join(",")}`;
  const expand = "requisitionList.workLocation,requisitionList.secondaryLocations";
  return `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=${encodeURIComponent(expand)}&finder=${finder}&limit=${ORACLE_PAGE_SIZE}&offset=${offset}`;
}

function oracleJobUrl(host: string, siteNumber: string, id: string): string {
  return `https://${host}/hcmUI/CandidateExperience/en/sites/${siteNumber}/job/${id}`;
}

async function scrapeOracleCloud(portal: CompanyPortal): Promise<RawJob[]> {
  const oc = portal.oraclecloud;
  if (!oc) throw new Error("Missing oraclecloud config");
  const siteNumber = oc.siteNumber ?? "CX_1";
  const all: RawJob[] = [];
  let total: number | null = null;

  for (let page = 0; page < ORACLE_MAX_PAGES; page++) {
    const offset = page * ORACLE_PAGE_SIZE;
    if (page > 0) await sleep(150);
    const json = await fetchJson<{ items?: { requisitionList?: OracleRequisition[]; TotalJobsCount?: number }[] }>(
      buildOracleUrl(oc.host, siteNumber, oc.locationId, offset),
      { headers: { "User-Agent": BROWSER_LIKE_USER_AGENT } },
    );
    const item = json.items?.[0];
    const list = item?.requisitionList ?? [];
    for (const req of list) {
      const id = req.Id != null ? String(req.Id) : req.RequisitionNumber != null ? String(req.RequisitionNumber) : "";
      const url = req.ExternalURL?.trim() || (id ? oracleJobUrl(oc.host, siteNumber, id) : "");
      if (!url) continue;
      const wl = req.workLocation?.[0];
      const base = req.PrimaryLocation?.trim() || [wl?.TownOrCity, wl?.Region, wl?.Country].filter(Boolean).join(", ");
      const remoteHint = req.WorkplaceTypeCode === "ORA_REMOTE" ? "Remote" : req.WorkplaceTypeCode === "ORA_HYBRID" ? "Hybrid" : "";
      const postedMs = req.PostedDate ? Date.parse(req.PostedDate) : NaN;
      all.push({
        source: "oraclecloud",
        sourceId: id || null,
        company: portal.name,
        title: req.Title ?? "",
        location: [base, remoteHint].filter(Boolean).join(" · ") || null,
        url,
        postedAt: Number.isNaN(postedMs) ? null : new Date(postedMs).toISOString(),
        description: null,
      });
    }
    if (total === null && typeof item?.TotalJobsCount === "number") total = item.TotalJobsCount;
    const listLen = list.length;
    // hasMore is unreliable on some tenants (career-ops' documented JPMC
    // finding) — trust the returned page length / TotalJobsCount instead.
    if (listLen === 0 || listLen < ORACLE_PAGE_SIZE) break;
    if (total !== null && offset + ORACLE_PAGE_SIZE >= total) break;
  }
  return all;
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

const WORKDAY_PAGE_SIZE = 20;
// Deliberately NOT a full-board pull (career-ops' workday.mjs does that,
// letting its title_filter sort relevance out afterward) — tried it here
// first: NVIDIA alone returned 2,000 postings (hit the cap) and took 95s
// for one company, the overwhelming majority senior/staff roles thrown away
// by classifyTitle a moment later. For a handful of specifically-registered
// companies rather than career-ops' thousands-wide directory scan, that
// trade is wrong. Kept the scoped, server-side-filtered search instead, but
// broadened it from 2 terms to the same vocabulary classify.ts's own
// NEW_GRAD_KEYWORDS/INTERN_KEYWORDS already look for — catches postings
// phrased "University Graduate", "Early Career", etc. that "new grad" alone
// would miss, without paying for a whole-board pull.
const WORKDAY_SEARCH_TERMS = ["intern", "co-op", "new grad", "college grad", "university graduate", "early career", "campus hire"];
const WORKDAY_MAX_PAGES_PER_TERM = 10; // 200 postings/term — a targeted query rarely needs this many

async function scrapeWorkday(portal: CompanyPortal): Promise<RawJob[]> {
  const wd = portal.workday;
  if (!wd) throw new Error("Missing workday config");
  const origin = `https://${wd.host}`;
  const api = `${origin}/wday/cxs/${wd.tenant}/${wd.site}/jobs`;
  const jobBase = `${origin}/en-US/${wd.site}`;
  // Some tenants front the CXS API with Cloudflare bot management that 500s
  // requests missing ordinary browser headers (confirmed live pattern from
  // career-ops against a Workday-hosted tenant) — a real Chrome UA +
  // accept-language + matching origin/referer clears it without per-tenant config.
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": BROWSER_LIKE_USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
    Origin: origin,
    Referer: `${jobBase}/`,
  };

  const byId = new Map<string, RawJob>();
  for (const searchText of WORKDAY_SEARCH_TERMS) {
    for (let page = 0; page < WORKDAY_MAX_PAGES_PER_TERM; page++) {
      const offset = page * WORKDAY_PAGE_SIZE;
      const data = await fetchJson<{ jobPostings?: WorkdayJob[]; total?: number }>(api, {
        method: "POST",
        headers,
        body: JSON.stringify({ appliedFacets: {}, limit: WORKDAY_PAGE_SIZE, offset, searchText }),
      });
      const postings = data.jobPostings ?? [];
      for (const j of postings) {
        if (!j.externalPath || !j.title?.trim()) continue;
        const sourceId = j.bulletFields?.[0] ?? j.externalPath;
        if (byId.has(sourceId)) continue; // same posting across overlapping search terms
        byId.set(sourceId, {
          source: "workday",
          sourceId,
          company: portal.name,
          title: j.title,
          location: j.locationsText ?? null,
          url: `${jobBase}${j.externalPath.replace(/^.*?(?=\/job\/)/, "")}`,
          postedAt: parseWorkdayPostedOn(j.postedOn),
          description: null,
        });
      }
      if (postings.length < WORKDAY_PAGE_SIZE || offset + WORKDAY_PAGE_SIZE >= (data.total ?? 0)) break;
      await sleep(150); // WAF-aware spacing between same-host pages
    }
  }
  return [...byId.values()];
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
  /** e.g. ["Fall 2026"] — many real postings never restate this in the title itself. */
  terms?: string[];
}

const SIMPLIFY_FEEDS: { repo: string; branches: string[] }[] = [
  { repo: "SimplifyJobs/New-Grad-Positions", branches: ["dev", "main"] },
  // SimplifyJobs names this repo after its anchor Summer season, but it
  // carries the whole surrounding cycle — confirmed live: as of 2026-07,
  // this is where current Fall 2026 postings actually are (Summer2027-
  // Internships below doesn't exist yet). Keeping both: this one for
  // what's live now, the 2027 one so it's picked up automatically once
  // SimplifyJobs creates it next season — no code change needed then.
  { repo: "SimplifyJobs/Summer2026-Internships", branches: ["dev", "main"] },
  { repo: "SimplifyJobs/Summer2027-Internships", branches: ["dev", "main"] },
];

/** Skip stale listings the accumulating repos never prune. */
const SIMPLIFY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Shared reader for the `listings.json` schema published by SimplifyJobs and
 * forks of its tooling (vanshb03/Summer2027-Internships uses the identical
 * shape, just a different maintainer/repo).
 */
async function scrapeListingsJsonFeeds(
  source: "simplifyjobs" | "vansh",
  feeds: { repo: string; branches: string[] }[],
  now: Date,
  notResolvedMessage: string,
): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  let anyResolved = false;

  for (const feed of feeds) {
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
        source,
        sourceId: l.id,
        company: l.company_name,
        title: l.title,
        location: l.locations?.filter(Boolean).join("; ") || null,
        url: l.url,
        postedAt: new Date(postedMs).toISOString(),
        description: null,
        seasonHint: l.terms?.[0] ?? null,
      });
    }
    await sleep(300);
  }

  if (!anyResolved) throw new Error(notResolvedMessage);
  return jobs;
}

export async function scrapeSimplifyFeeds(now: Date = new Date()): Promise<RawJob[]> {
  return scrapeListingsJsonFeeds(
    "simplifyjobs",
    SIMPLIFY_FEEDS,
    now,
    "No SimplifyJobs feed resolved (all candidate repos/branches failed)",
  );
}

// ── vanshb03 community feeds (same listings.json tooling as SimplifyJobs) ──
/**
 * vanshb03/Summer2027-Internships and vanshb03/New-Grad-2027 aggregate the
 * same kind of early-career postings as SimplifyJobs, independently
 * maintained, publishing the identical `listings.json` shape (same field
 * names, same `dev`/`main` branch fallback pattern, both carry true
 * `date_posted` timestamps). Grouped under one "vansh" source — same
 * maintainer/tooling, intern + new-grad halves of the same feed family — so
 * scanned-source bookkeeping and attribution stay honest as one unit;
 * cross-source duplicates still collapse via the normal canonical-URL dedupe.
 */
const VANSH_FEEDS: { repo: string; branches: string[] }[] = [
  { repo: "vanshb03/Summer2027-Internships", branches: ["dev", "main"] },
  { repo: "vanshb03/New-Grad-2027", branches: ["dev", "main"] },
];

export async function scrapeVanshFeed(now: Date = new Date()): Promise<RawJob[]> {
  return scrapeListingsJsonFeeds(
    "vansh",
    VANSH_FEEDS,
    now,
    "vanshb03 feed unavailable (all candidate branches failed)",
  );
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
  atlassian: scrapeAtlassian,
  eightfold: scrapeEightfold,
  bamboohr: scrapeBambooHR,
  recruitee: scrapeRecruitee,
  breezy: scrapeBreezy,
  rippling: scrapeRippling,
  personio: scrapePersonio,
  pinpoint: scrapePinpoint,
  shopify: scrapeShopify,
  jibeapply: scrapeJibeApply,
  oraclecloud: scrapeOracleCloud,
};
