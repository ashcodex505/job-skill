import type { Browser, BrowserContext, Page } from "playwright";
import type { RawJob } from "./normalize";

/**
 * Headless-browser scraping for companies with no public API (Google, Apple,
 * Meta, etc.) — the deliberately separate, local-only counterpart to
 * adapters.ts's JSON-only adapters. Ported from career-ops' browser-extract.mjs
 * (github.com/santifer/career-ops), which uses one GENERIC extractor instead
 * of per-company CSS selectors: launch headless Chromium, let the page
 * hydrate, then read every visible job-like link off the rendered DOM.
 *
 * This file must NEVER be imported by anything CI touches (board-cli.ts,
 * run.ts's default path, any .github/workflows/*.yml). It is wired in only
 * by src/app/api/scrape/browser/route.ts, which is only ever reachable while
 * the Next.js dev/prod server is running locally — see docs/browser-scraping.md
 * for the full "why local-only" rationale (datacenter IPs from CI runners are
 * far more likely to be flagged by anti-bot systems than a residential IP).
 *
 * Improvements over career-ops' version, ported as a starting point rather
 * than copied as a ceiling:
 *  - Explicit blocked/challenge-page detection (`BlockedError`) instead of
 *    silently returning an empty job list — a WAF challenge page and "this
 *    company genuinely has zero open roles" must never look the same to the
 *    caller, since the latter is normal and the former means don't trust
 *    this result at all.
 *  - Output is RawJob[] directly (source: "browser"), so results flow
 *    through the exact same classifyTitle/normalizeJob/career-policy
 *    pipeline as every JSON adapter — no separate translation layer.
 *  - One shared Chromium instance across a whole scan run (not
 *    launch-per-company) — cheaper, and still one fresh browser context
 *    (cookies/storage) per company so sites can't correlate requests.
 */

// Playwright's default headless UA literally contains "HeadlessChrome",
// which Cloudflare and similar WAFs detect and block outright. A realistic
// desktop Chrome UA is career-ops' documented fix (liveness-browser.mjs) —
// confirmed there to clear the wall on real sites without anything fancier.
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NAVIGATE_TIMEOUT_MS = 20_000;
const HYDRATION_WAIT_MS = 2_500;
const LISTING_MAX = 300;

/** Navigation chrome, not job postings — dropped by label, case-insensitive. */
const NAV_LABEL_STOPWORDS = new Set([
  "home", "about", "about us", "contact", "contact us", "login", "log in", "sign in",
  "sign up", "register", "privacy", "privacy policy", "terms", "cookies", "cookie policy",
  "careers", "jobs", "search", "menu", "back", "next", "previous", "apply", "apply now",
  "learn more", "read more", "faq", "blog", "news", "help", "support", "english",
  "accept", "accept all", "accept cookies", "reject", "reject all", "manage cookies",
]);

/** Common anti-bot challenge / hard-block page signatures, checked against title + visible text. */
const BLOCK_SIGNATURES = [
  /just a moment/i, // Cloudflare challenge interstitial
  /checking your browser/i,
  /access denied/i,
  /are you a human/i,
  /are you a robot/i,
  /\bcaptcha\b/i,
  /request blocked/i,
  /unusual traffic/i,
  /px-captcha/i, // PerimeterX
  /akamai/i,
  /reference #\d+\.[0-9a-f]+/i, // Akamai/edge block-page reference ids
];

export class BlockedError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`browser-scrape blocked at ${url}: ${reason}`);
    this.name = "BlockedError";
  }
}

export interface BrowserCompany {
  name: string;
  careersUrl: string;
  /**
   * Confirmed live: some search-driven sites (Apple) ignore a query string
   * on initial page load — the search only fires once a real input is
   * filled and submitted. When set, scrapeCompanyListing finds the most
   * plausible search box on the page, types this in, and presses Enter
   * before reading the DOM.
   */
  searchQuery?: string;
  /** Declared season hint (e.g. "Fall 2026") passed through to RawJob.seasonHint — see BrowserCompanyEntry.seasonHint for why this exists. */
  seasonHint?: string;
}

interface ListingAnchor {
  href: string;
  label: string;
}

interface RawListing {
  title: string;
  text: string;
  anchors: ListingAnchor[];
}

/** Runs inside the page — plain-data return only, no closures over Node state. */
async function readDom(page: Page): Promise<RawListing> {
  return page.evaluate(() => {
    const title = (document.querySelector("h1")?.textContent || document.title || "").trim();

    const root = document.querySelector("main, [role='main'], article") || document.body;
    let text = "";
    if (root) {
      const clone = root.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, nav, header, footer, noscript").forEach((el) => el.remove());
      text = (clone as HTMLElement).innerText || "";
    }

    const anchors = Array.from(document.querySelectorAll("a[href]"))
      .filter((el) => {
        if (el.closest("nav, header, footer")) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        return el.getClientRects().length > 0;
      })
      .map((el) => ({ href: el.getAttribute("href") || "", label: ((el as HTMLElement).innerText || el.textContent || "").trim() }));

    return { title, text, anchors };
  });
}

// Confirmed live: only Microsoft's Eightfold-hosted listing exposes a
// posted-date signal on the search results page, glued into the anchor
// text via the same innerText concatenation as everything else ("...Posted
// 3 hours ago"). Every other browser-scanned company (Meta, Google, Apple,
// Snowflake, Two Sigma, TikTok) has no date information there at all —
// confirmed by searching their rendered page text for any "posted/updated
// ... ago" phrase and finding none. postedAt stays null for those, same as
// before; the freshness filter this feeds (see isFreshEnough) explicitly
// treats an unknown age as "can't verify, don't penalize."
const RELATIVE_POSTED_RE = /\bposted\s+(a|an|\d+)\s*(hour|day|week|month|year)s?\s+ago\b/i;
const POSTED_TODAY_RE = /\bposted\s+today\b/i;
const MS_PER_UNIT: Record<string, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000, // approximate — fine for a freshness cutoff, not billing
  year: 365 * 86_400_000,
};

/** Parses a "Posted X ago" / "Posted today" phrase into an ISO date. Returns null when the text has no such phrase. Pure — exported for tests. */
export function parseRelativePostedAt(text: string, now: Date = new Date()): string | null {
  if (POSTED_TODAY_RE.test(text)) return now.toISOString();
  const m = text.match(RELATIVE_POSTED_RE);
  if (!m) return null;
  const amount = /^an?$/i.test(m[1]) ? 1 : parseInt(m[1], 10);
  const msPerUnit = MS_PER_UNIT[m[2].toLowerCase()];
  if (!Number.isFinite(amount) || !msPerUnit) return null;
  return new Date(now.getTime() - amount * msPerUnit).toISOString();
}

/** Strips a trailing "Posted X ago" phrase for a cleaner display title once the date's been extracted into postedAt. Pure — exported for tests. */
export function stripPostedPhrase(text: string): string {
  return text.replace(/\s*\bposted\s+(?:today|(?:a|an|\d+)\s*(?:hour|day|week|month|year)s?\s+ago)\b.*$/i, "").trim();
}

function normalizeListingAnchors(anchors: ListingAnchor[], baseUrl: string, max: number): { title: string; url: string }[] {
  const jobs: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const a of anchors) {
    const label = a.label.replace(/\s+/g, " ").trim();
    if (label.length < 3 || NAV_LABEL_STOPWORDS.has(label.toLowerCase())) continue;
    let url: string;
    try {
      const parsed = new URL(a.href, baseUrl);
      if (!/^https?:$/.test(parsed.protocol)) continue;
      url = parsed.href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    jobs.push({ title: label, url });
    if (jobs.length >= max) break;
  }
  return jobs;
}

function detectBlock(dom: RawListing, jobCount: number): string | null {
  const haystack = `${dom.title}\n${dom.text.slice(0, 2000)}`;
  for (const sig of BLOCK_SIGNATURES) {
    if (sig.test(haystack)) return `page matched block signature: ${sig}`;
  }
  // Zero extracted job-like links on a page that otherwise rendered real
  // text is suspicious — a genuinely empty careers page usually still says
  // something like "No open roles right now," not literally nothing.
  if (jobCount === 0 && dom.text.trim().length < 40) return "page rendered almost no visible text (likely blocked or failed to hydrate)";
  return null;
}

const jitter = (baseMs: number) => baseMs + Math.floor(Math.random() * baseMs);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function newHardenedContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ userAgent: DESKTOP_CHROME_UA, locale: "en-US", viewport: { width: 1440, height: 900 } });
}

/** Search inputs a search-driven career site is unlikely to mean as its main "what role" box. */
const SEARCH_INPUT_NEGATIVE_RE = /location|team|language|country|city|zip|postal/i;
const SEARCH_INPUT_POSITIVE_RE = /search|role|keyword|job|position|title/i;

/**
 * Best-effort: finds the most plausible "search by role/keyword" text input
 * on the page (scored by placeholder/aria-label/name/id, penalizing known
 * non-role filters like location/team/language typeaheads), types `query`
 * into it, and presses Enter. Confirmed live necessary for Apple's careers
 * site, which — unlike Microsoft's or Meta's — ignores a query string on
 * initial page load and only searches once a real input is submitted.
 * Returns false (never throws) if no plausible input is found, so callers
 * can fall back to reading whatever the page already rendered.
 */
async function fillAndSubmitSearch(page: Page, query: string): Promise<boolean> {
  const marker = "data-rt-search-target";
  const found = await page.evaluate(
    ({ marker, positiveSrc, negativeSrc }) => {
      const positive = new RegExp(positiveSrc, "i");
      const negative = new RegExp(negativeSrc, "i");
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="search"], input:not([type])'));
      let best: HTMLInputElement | null = null;
      let bestScore = 0;
      for (const el of inputs) {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || el.getClientRects().length === 0) continue;
        const hay = `${el.placeholder} ${el.getAttribute("aria-label") ?? ""} ${el.name} ${el.id}`.toLowerCase();
        let score = 0;
        if (positive.test(hay)) score += 2;
        if (negative.test(hay)) score -= 3;
        if (el.type === "search") score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
      if (!best) return false;
      best.setAttribute(marker, "1");
      return true;
    },
    { marker, positiveSrc: SEARCH_INPUT_POSITIVE_RE.source, negativeSrc: SEARCH_INPUT_NEGATIVE_RE.source },
  );
  if (!found) return false;
  const locator = page.locator(`[${marker}="1"]`);
  await locator.fill(query);
  await locator.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: NAVIGATE_TIMEOUT_MS }).catch(() => {});
  return true;
}

/**
 * Scans one company's careers page for job-like links. Throws BlockedError
 * if the page looks like a challenge/block page rather than a real result —
 * callers must treat that as "unknown," never as "confirmed zero postings."
 */
export async function scrapeCompanyListing(browser: Browser, company: BrowserCompany): Promise<RawJob[]> {
  const context = await newHardenedContext(browser);
  try {
    const page = await context.newPage();
    await page.goto(company.careersUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATE_TIMEOUT_MS });
    await page.waitForTimeout(HYDRATION_WAIT_MS); // let client-hydrated SPAs finish rendering
    if (company.searchQuery) {
      await fillAndSubmitSearch(page, company.searchQuery);
      await page.waitForTimeout(HYDRATION_WAIT_MS);
    }
    const finalUrl = page.url();
    const dom = await readDom(page);
    const jobs = normalizeListingAnchors(dom.anchors, finalUrl, LISTING_MAX);

    const blockReason = detectBlock(dom, jobs.length);
    if (blockReason) throw new BlockedError(finalUrl, blockReason);

    return jobs.map((j) => {
      const postedAt = parseRelativePostedAt(j.title);
      return {
        source: "browser",
        sourceId: null, // URL is the dedup key, same as recruitee/pinpoint/breezy
        company: company.name,
        // Strip the "Posted X ago" phrase once its date is extracted — it's
        // now redundant text, and it's also literal text that changes on
        // every scan ("3 hours ago" → "4 hours ago"), which would otherwise
        // pollute the title shown in the dashboard/GitHub issue each time.
        // Never strips the location text right next to it — the US-only
        // filter in normalize.ts depends on that still being here.
        title: postedAt ? stripPostedPhrase(j.title) : j.title,
        location: null, // generic DOM extraction has no reliable structured location field
        url: j.url,
        postedAt, // null for every company except Microsoft — see the comment above parseRelativePostedAt
        description: null,
        seasonHint: company.seasonHint ?? null,
      };
    });
  } finally {
    await context.close();
  }
}

// ── Google careers — dedicated extractor ────────────────────────────────
// Confirmed live: Google's search results (careers.google.com) render as
// li.lLd3Je cards built from its internal Closure/Material JS framework, not
// real <a href> elements — the generic anchor-based extractor above finds
// nothing at all here. This is a deliberate, narrowly-scoped exception to
// this file's "one generic extractor, no per-company selectors" design
// (same kind of exception adapters.ts already makes for Amazon, which also
// needed its own non-uniform scraping logic), not a precedent to keep
// widening — most companies should still go through the generic path.

const GOOGLE_JSDATA_ID_RE = /^[^;]*;(\d+);/;

/** Parses a Google Careers job card's `jsdata` attribute into its canonical job URL. Pure — exported for tests. */
export function googleJobUrlFromJsData(jsdata: string): string | null {
  const m = jsdata.match(GOOGLE_JSDATA_ID_RE);
  if (!m) return null;
  return `https://www.google.com/about/careers/applications/jobs/results/${m[1]}`;
}

interface GoogleJobCard {
  jsdata: string;
  title: string;
  location: string;
}

interface GoogleSearchPlan {
  query: string;
  targetLevel?: "EARLY" | "INTERN_AND_APPRENTICE";
  pages: number;
}

// Separate level searches are intentional. Google's combined level filter
// ranks enough unrelated roles above Early Career that the Campus posting
// which prompted this watcher disappeared from page one.
export const GOOGLE_SEARCH_PLANS: readonly GoogleSearchPlan[] = [
  { query: "software engineer", targetLevel: "EARLY", pages: 3 },
  { query: "software engineer", targetLevel: "INTERN_AND_APPRENTICE", pages: 3 },
  { query: '"Software Engineer, Early Career"', pages: 1 },
  { query: '"Software Engineer, New Grad"', pages: 1 },
  { query: '"Software Engineer, Campus"', pages: 1 },
];

/** Builds the independently paginated Google discovery URLs. Pure — exported for tests. */
export function googleCareersSearchUrls(): string[] {
  const base = "https://www.google.com/about/careers/applications/jobs/results/";
  return GOOGLE_SEARCH_PLANS.flatMap((plan) =>
    Array.from({ length: plan.pages }, (_, index) => {
      const url = new URL(base);
      url.searchParams.set("q", plan.query);
      if (plan.targetLevel) url.searchParams.set("target_level", plan.targetLevel);
      if (index > 0) url.searchParams.set("page", String(index + 1));
      return url.href;
    }),
  );
}

async function readGoogleCards(page: Page): Promise<GoogleJobCard[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("li.lLd3Je")).map((li) => ({
      jsdata: li.querySelector("[jsdata]")?.getAttribute("jsdata") ?? "",
      title: li.querySelector("h3")?.textContent?.trim() ?? "",
      location: Array.from(li.querySelectorAll(".r0wTof")).map((el) => el.textContent?.trim() ?? "").filter(Boolean).join("; "),
    })),
  );
}

async function scrapeGoogleCareers(browser: Browser, company: BrowserCompany): Promise<RawJob[]> {
  const context = await newHardenedContext(browser);
  try {
    const page = await context.newPage();
    const jobs: RawJob[] = [];
    const seen = new Set<string>();

    // The configured URL selects Google as a browser-scan company; discovery
    // itself uses these controlled queries so a stale/narrow q= value in the
    // Markdown file cannot hide an Early Career posting again.
    for (const searchUrl of googleCareersSearchUrls()) {
      // Google's cards arrive via an XHR after the document. networkidle is
      // the reliable readiness signal; the short extra wait absorbs card
      // rendering without opening every individual detail page.
      await page.goto(searchUrl, { waitUntil: "networkidle", timeout: NAVIGATE_TIMEOUT_MS + 5000 }).catch(() => {});
      await page.waitForTimeout(HYDRATION_WAIT_MS);

      const dom = await readDom(page);
      const cards = await readGoogleCards(page);
      const blockReason = detectBlock(dom, cards.length);
      if (blockReason) throw new BlockedError(page.url(), blockReason);
      if (cards.length === 0) continue;

      for (const c of cards) {
        if (!c.title) continue;
        const url = googleJobUrlFromJsData(c.jsdata);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        jobs.push({
          source: "browser",
          sourceId: null,
          company: company.name,
          title: c.title,
          location: c.location || null,
          url,
          postedAt: null,
          description: null,
          seasonHint: company.seasonHint ?? null,
        });
        if (jobs.length >= LISTING_MAX) return jobs;
      }
    }
    return jobs;
  } finally {
    await context.close();
  }
}

function isGoogleCareersUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith("google.com");
  } catch {
    return false;
  }
}

/** Freshness cutoff for browser-scanned postings — deliberately scoped to this source only, not the board-wide maxPostingAgeDays gate. */
export const BROWSER_SCAN_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * True if `postedAt` is unknown (can't verify age, so don't penalize — the
 * only companies with a real postedAt today are ones using
 * parseRelativePostedAt, i.e. Microsoft) or within BROWSER_SCAN_MAX_AGE_MS.
 * Pure — exported for tests.
 */
export function isFreshEnough(postedAt: string | null, now: number = Date.now()): boolean {
  if (!postedAt) return true;
  const postedMs = new Date(postedAt).getTime();
  if (!Number.isFinite(postedMs)) return true;
  return now - postedMs <= BROWSER_SCAN_MAX_AGE_MS;
}

export interface BrowserScrapeResult {
  jobs: RawJob[];
  scanned: string[];
  errors: { company: string; message: string }[];
}

/**
 * Scans every configured company sequentially — deliberately NOT concurrent,
 * unlike the JSON adapters' pool. Each company is a full browser context +
 * page render, a much heavier unit of work than an HTTP call, and running
 * several headless Chromium pages at once on a personal machine (while
 * you're also using it) is a worse trade than a few extra seconds of
 * sequential wall time. A jittered delay between companies avoids both a
 * fixed-cadence fingerprint and rate-based WAF thresholds.
 */
export async function scrapeBrowserCompanies(companies: BrowserCompany[]): Promise<BrowserScrapeResult> {
  const jobs: RawJob[] = [];
  const scanned: string[] = [];
  const errors: { company: string; message: string }[] = [];
  if (companies.length === 0) return { jobs, scanned, errors };

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const company of companies) {
      try {
        const found = isGoogleCareersUrl(company.careersUrl)
          ? await scrapeGoogleCareers(browser, company)
          : await scrapeCompanyListing(browser, company);
        jobs.push(...found);
        scanned.push(company.name);
        console.log(`  [browser] ${company.name}: ${found.length} job-like links`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ company: company.name, message });
        console.warn(`  [browser] ${company.name}: FAILED — ${message}`);
      }
      await sleep(jitter(2000)); // 2-4s, politeness + anti-fingerprint jitter
    }
  } finally {
    await browser.close();
  }
  return { jobs, scanned, errors };
}
