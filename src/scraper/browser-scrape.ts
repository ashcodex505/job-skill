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

    return jobs.map((j) => ({
      source: "browser",
      sourceId: null, // URL is the dedup key, same as recruitee/pinpoint/breezy
      company: company.name,
      title: j.title,
      location: null, // generic DOM extraction has no reliable structured location field
      url: j.url,
      postedAt: null, // no reliable date signal from a generic listing page
      description: null,
      seasonHint: company.seasonHint ?? null,
    }));
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
    // Google's job cards load via an XHR after the initial document —
    // domcontentloaded fires before they exist. networkidle (confirmed live,
    // ~2-3s here) is what actually waits long enough to see them.
    await page.goto(company.careersUrl, { waitUntil: "networkidle", timeout: NAVIGATE_TIMEOUT_MS + 5000 }).catch(() => {});
    await page.waitForTimeout(HYDRATION_WAIT_MS);

    const dom = await readDom(page);
    const cards = await readGoogleCards(page);
    const blockReason = detectBlock(dom, cards.length);
    if (blockReason) throw new BlockedError(page.url(), blockReason);

    const jobs: RawJob[] = [];
    const seen = new Set<string>();
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
