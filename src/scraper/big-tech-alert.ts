import { canonicalUrl, isApprovedCompany } from "./normalize";
import type { BoardJob } from "./board";

/**
 * Big-tech / unicorn alert stream: a separate, higher-signal notification
 * than the per-run job-alert issue. Fires only for companies on the list
 * below — prestigious big tech and top private unicorns ("better than Amex")
 * — and never for quant-trading firms, banks, or card networks, which are
 * excluded wholesale along with trading-flavored role titles.
 */
export const BIG_TECH_COMPANIES: string[] = [
  // FAANG+ and megacaps
  "Apple", "Google", "Alphabet", "DeepMind", "YouTube", "Waymo", "Meta", "Microsoft", "GitHub",
  "Amazon", "AWS", "Netflix", "NVIDIA", "Tesla", "Adobe", "Salesforce", "Oracle", "IBM Research",
  "Uber", "Airbnb", "LinkedIn", "TikTok", "ByteDance", "Snap", "Pinterest", "Reddit", "Spotify",
  "Dropbox", "Atlassian", "Shopify", "Block", "Square", "DoorDash", "Lyft", "Intuit", "Workday",
  "ServiceNow", "Palo Alto Networks", "Qualcomm", "AMD", "Intel", "Broadcom", "Arm",
  // AI labs & AI-first unicorns
  "OpenAI", "Anthropic", "xAI", "Mistral AI", "Perplexity", "Scale AI", "Hugging Face",
  "Cohere", "Runway", "Cursor", "Anysphere", "Sierra", "Harvey", "Glean", "Together AI",
  // Elite unicorns / high-growth private tech
  "Databricks", "Stripe", "Figma", "Canva", "Notion", "Ramp", "Brex", "Plaid", "Rippling",
  "Deel", "Airtable", "Retool", "Vercel", "Linear", "Samsara", "Verkada", "Anduril", "SpaceX",
  "Palantir", "Snowflake", "MongoDB", "Cloudflare", "Datadog", "Confluent", "HashiCorp",
  "Roblox", "Discord", "Coinbase", "Instacart", "Wiz", "CrowdStrike", "Zscaler", "Neuralink",
];

/** Quant firms, banks, and card networks — excluded regardless of prestige. */
export const EXCLUDED_COMPANIES: string[] = [
  // Quant / prop trading / hedge funds
  "Jane Street", "Citadel", "Citadel Securities", "Two Sigma", "Hudson River Trading", "HRT",
  "Jump Trading", "DRW", "IMC", "IMC Trading", "Optiver", "Akuna Capital", "Five Rings",
  "Susquehanna", "SIG", "Point72", "Millennium", "Millennium Management", "Tower Research",
  "Virtu", "Flow Traders", "DE Shaw", "D. E. Shaw", "Bridgewater", "AQR", "Radix Trading",
  "Old Mission", "Belvedere Trading", "Chicago Trading Company", "Wolverine Trading",
  "Group One Trading", "Peak6", "Valkyrie Trading", "XTX Markets", "Squarepoint",
  // Banks / traditional finance / card networks
  "JPMorgan", "JPMorgan Chase", "J.P. Morgan", "Goldman Sachs", "Morgan Stanley",
  "Bank of America", "Citi", "Citigroup", "Wells Fargo", "Capital One", "American Express",
  "Amex", "Visa", "Mastercard", "PayPal", "Barclays", "UBS", "Deutsche Bank", "HSBC",
  "BNY Mellon", "State Street", "Charles Schwab", "Fidelity", "Vanguard", "BlackRock",
  "Discover", "Synchrony", "US Bank", "PNC", "Truist", "RBC", "TD Bank", "Nomura",
];

/** Role titles that are quant/trading/banking even at an allowed company. */
const EXCLUDED_TITLE = /\b(quant(itative)?|trader|trading|market maker|portfolio|investment bank|treasury|actuar)/i;

export interface BigTechAlertJob extends BoardJob {}

/**
 * From the jobs that appeared THIS cycle, pick the ones worth a dedicated
 * notification: big-tech/unicorn company, intern or new-grad role, not
 * quant/banking. Watchlist matches are excluded when provided — they already
 * fire their own URGENT issue and should not double-notify.
 */
export function selectBigTechAlerts(newJobs: BoardJob[], alreadyAlerted: BoardJob[] = []): BoardJob[] {
  const skip = new Set(alreadyAlerted.map((j) => j.dedupeKey));
  return newJobs.filter((job) => {
    if (skip.has(job.dedupeKey)) return false;
    if (job.roleType !== "internship" && job.roleType !== "new_grad") return false;
    if (isApprovedCompany(job.company, EXCLUDED_COMPANIES)) return false;
    if (EXCLUDED_TITLE.test(job.title)) return false;
    return isApprovedCompany(job.company, BIG_TECH_COMPANIES);
  });
}

// ── Alert ledger ──────────────────────────────────────────────────────
/**
 * Hard guarantee against repeat notifications: every posting ever included
 * in a ⭐ big-tech or 🚨 urgent issue is recorded by canonical URL in
 * board/alerted.json (committed alongside the board). Whatever the diff
 * logic decides, a URL in the ledger is never alerted again.
 */
export interface AlertLedger {
  [canonicalJobUrl: string]: string; // ISO date first alerted
}

const LEDGER_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export function filterUnalerted(ledger: AlertLedger, jobs: BoardJob[]): BoardJob[] {
  return jobs.filter((j) => !(canonicalUrl(j.url) in ledger));
}

/** Returns a new ledger with `alerted` recorded and stale entries pruned. */
export function recordAlerted(ledger: AlertLedger, alerted: BoardJob[], now: string): AlertLedger {
  const next: AlertLedger = {};
  const cutoff = new Date(now).getTime() - LEDGER_RETENTION_MS;
  for (const [url, at] of Object.entries(ledger)) {
    const t = new Date(at).getTime();
    if (Number.isFinite(t) && t >= cutoff) next[url] = at;
  }
  for (const j of alerted) next[canonicalUrl(j.url)] = now;
  return next;
}
