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
  // Reconciled once against career/preferences.md's Summer 2027 approved
  // company list (2026-07-23) so every company you'd personally curated as
  // "worth a dedicated ping" at the time actually got one.
  "Asana", "Duolingo", "ElevenLabs", "Robinhood", "Supabase", "Zoox", "Applied Intuition",
  "Bloomberg", "Affirm", "Grammarly", "Replit", "GitLab", "Okta", "Epic Games", "Character.AI",
  // Broad expansion (2026-07-28), judgment call rather than sourced from any
  // list you curated — genuinely $1B+ / widely-recognized companies across
  // categories underrepresented above, so fewer of these need you to notice
  // a miss and add them by hand. Several (Saronic, Astranis, Hermeus,
  // Cerebras, SambaNova, Nuro, Zipline) are already confirmed actually
  // posting into this board's feeds, not speculative additions.
  // AI labs / AI infra
  "Midjourney", "Stability AI", "Inflection AI", "Groq", "Fireworks AI", "Modal",
  "Cerebras", "SambaNova Systems", "World Labs", "Physical Intelligence", "Suno",
  // Fintech / crypto
  "Gemini", "Kraken", "Circle", "Chime", "Mercury", "Marqeta", "Wealthfront",
  // Space / defense / hard tech
  "Saronic Technologies", "Astranis Space Technologies", "Hermeus", "Shield AI",
  "Skydio", "Varda Space Industries",
  // Robotics / autonomy
  "Nuro", "Figure AI", "1X Technologies", "Agility Robotics", "Zipline",
  // Dev tools / infra
  "Temporal", "PlanetScale", "Neon", "Clerk", "WorkOS", "Sourcegraph", "Warp",
  "Postman", "Airbyte", "dbt Labs",
  // Other widely-recognized unicorns
  "Miro", "Gusto", "Remote", "Symbotic",
];
// This static list is deliberately backstopped, not load-bearing on its own:
// selectBigTechAlerts() merges in your live career/preferences.md
// approved-company list every run (see below), so a company missing from
// BOTH here and there is the only case that still needs a manual add.
// That one-time reconciliation immediately went stale: you added "Gemini" to
// preferences.md's approved-company list afterward, and it silently never
// became alert-eligible — the exact class of bug a static, hand-maintained
// list will always eventually produce. selectBigTechAlerts() now takes your
// live approved-company list as a parameter and merges it in every run, so
// this list only ever needs to describe the companies you didn't already
// tell the system about some other way.

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

export type BigTechAlertJob = BoardJob;

/**
 * "New to our board" is not the same as "recently posted" — a company added
 * to the registry (or newly covered by a feed) surfaces its ENTIRE existing
 * backlog as "new" on the first scrape, even if the employer posted it
 * months ago. Without this, expanding coverage (adding an adapter, adding a
 * feed) floods the big-tech stream with stale postings. One week is the
 * hard outer bound; job-alert.ts's separate ≤5h "JUST POSTED" flag already
 * highlights the genuinely fresh ones within that window.
 */
const MAX_POSTING_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A posting with no confirmed date can't be proven recent — err toward not alerting. */
function isRecentEnough(job: BoardJob, nowMs: number): boolean {
  if (!job.postedAt) return false;
  const posted = new Date(job.postedAt).getTime();
  return Number.isFinite(posted) && nowMs - posted <= MAX_POSTING_AGE_MS;
}

/**
 * From the jobs that appeared THIS cycle, pick the ones worth a dedicated
 * notification: big-tech/unicorn company, intern or new-grad role, not
 * quant/banking, posted within the last week. Watchlist matches are
 * excluded when provided — they already fire their own URGENT issue and
 * should not double-notify.
 *
 * `extraApprovedCompanies` is your live career/preferences.md "Summer 2027
 * approved companies" list (that file's own description: "major technology
 * companies, unicorns, selective product companies, strong developer-
 * infrastructure businesses, and small high-signal technology startups" —
 * the same bar BIG_TECH_COMPANIES exists for). Merging it in here means
 * adding a company via the dashboard makes it alert-eligible immediately,
 * with no separate manual sync into this file ever required again.
 */
export function selectBigTechAlerts(
  newJobs: BoardJob[],
  alreadyAlerted: BoardJob[] = [],
  now: string = new Date().toISOString(),
  extraApprovedCompanies: string[] = [],
): BoardJob[] {
  const skip = new Set(alreadyAlerted.map((j) => j.dedupeKey));
  const nowMs = new Date(now).getTime();
  const allowlist = extraApprovedCompanies.length ? [...BIG_TECH_COMPANIES, ...extraApprovedCompanies] : BIG_TECH_COMPANIES;
  return newJobs.filter((job) => {
    if (skip.has(job.dedupeKey)) return false;
    if (job.roleType !== "internship" && job.roleType !== "new_grad") return false;
    if (isApprovedCompany(job.company, EXCLUDED_COMPANIES)) return false;
    if (EXCLUDED_TITLE.test(job.title)) return false;
    if (!isRecentEnough(job, nowMs)) return false;
    return isApprovedCompany(job.company, allowlist);
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
