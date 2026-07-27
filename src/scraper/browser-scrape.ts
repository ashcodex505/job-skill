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
      .map((el) => ({ href: el.getAttribute("href") || "", label: (el.textContent || "").trim() }));

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
    }));
  } finally {
    await context.close();
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
        const found = await scrapeCompanyListing(browser, company);
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
