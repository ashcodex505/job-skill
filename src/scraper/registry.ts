/**
 * Company → ATS registry (career-ops style "portals" config).
 *
 * Supported adapters hit official, public, unauthenticated job APIs:
 *  - greenhouse:      boards-api.greenhouse.io (documented public API)
 *  - lever:           api.lever.co/v0/postings (documented public API)
 *  - ashby:           api.ashbyhq.com/posting-api (documented public API)
 *  - workday:         the career site's own JSON endpoint (rate-limited, GET-equivalent)
 *  - smartrecruiters: api.smartrecruiters.com/v1 postings (documented public API)
 *  - workable:        apply.workable.com widget API (documented public API)
 *  - amazon:          amazon.jobs/en/search.json — Amazon's own site-search backend
 *  - eightfold:        {tenant-host}/api/apply/v2/jobs — Eightfold-hosted career sites
 *                      (confirmed: Netflix). Many other big companies use Eightfold
 *                      under a tenant string that doesn't match their public domain
 *                      and isn't guessable; add one only once its host+domain pair
 *                      is confirmed working, the way Netflix's was.
 *
 * Companies with `ats: "unsupported"` were checked and found to require
 * authenticated/session-bound APIs, private GraphQL, or Akamai/edge anti-bot
 * protection (Google, Apple, Meta, Microsoft, Uber, LinkedIn, Snowflake,
 * Tesla, Shopify, TikTok, Snap, Applied Intuition, Bloomberg, Grammarly,
 * HashiCorp — each individually probed against every adapter type above,
 * not assumed). We never bypass those; they're listed with a careers link
 * for manual checking and are natural future adapters if that ever changes.
 * Four of them (Google, Apple, Meta, Microsoft) are instead covered by the
 * local-only headless-browser scan — see career/browser-companies.md and
 * docs/browser-scraping.md. Microsoft in particular: its careers site
 * migrated to apply.careers.microsoft.com, an Eightfold-hosted instance
 * (confirmed via x-ef-* response headers) — but its /api/apply/v2/jobs
 * endpoint returns "Not authorized for PCSX" to a plain HTTP request even
 * with the exact query shape our own Eightfold adapter uses for Netflix, a
 * deliberate session/CSRF gate we don't attempt to bypass. It's browser-scan
 * only, not a real Eightfold adapter, despite the underlying platform match.
 *
 * A wrong slug only produces a per-company error in scraper_runs — the run
 * itself continues.
 */

export interface CompanyPortal {
  name: string;
  website: string;
  careersUrl: string;
  ats:
    | "greenhouse"
    | "lever"
    | "ashby"
    | "workday"
    | "smartrecruiters"
    | "workable"
    | "amazon"
    | "eightfold"
    | "bamboohr"
    | "recruitee"
    | "breezy"
    | "rippling"
    | "personio"
    | "pinpoint"
    | "jibeapply"
    | "oraclecloud"
    | "unsupported";
  /** greenhouse board token / lever slug / ashby board name / smartrecruiters company id /
   * workable account slug / bamboohr, recruitee, breezy, rippling, pinpoint, jibeapply tenant slug */
  slug?: string;
  /** workday only */
  workday?: { tenant: string; host: string; site: string };
  /** eightfold only */
  eightfold?: { host: string; domain: string };
  /** personio only — full tenant host, e.g. "acme.jobs.personio.de" (region varies by tenant) */
  personio?: { host: string };
  /** oraclecloud only — host is the full ORC tenant host, e.g. "acme.fa.us2.oraclecloud.com" */
  oraclecloud?: { host: string; siteNumber?: string; locationId?: string };
}

export const COMPANY_PORTALS: CompanyPortal[] = [
  // ── Greenhouse ──────────────────────────────────────────────────────
  { name: "Stripe", website: "https://stripe.com", careersUrl: "https://stripe.com/jobs", ats: "greenhouse", slug: "stripe" },
  { name: "Databricks", website: "https://databricks.com", careersUrl: "https://databricks.com/company/careers", ats: "greenhouse", slug: "databricks" },
  { name: "Anthropic", website: "https://anthropic.com", careersUrl: "https://anthropic.com/careers", ats: "greenhouse", slug: "anthropic" },
  { name: "Figma", website: "https://figma.com", careersUrl: "https://figma.com/careers", ats: "greenhouse", slug: "figma" },
  { name: "Samsara", website: "https://samsara.com", careersUrl: "https://samsara.com/company/careers", ats: "greenhouse", slug: "samsara" },
  { name: "MongoDB", website: "https://mongodb.com", careersUrl: "https://mongodb.com/careers", ats: "greenhouse", slug: "mongodb" },
  { name: "Cloudflare", website: "https://cloudflare.com", careersUrl: "https://cloudflare.com/careers", ats: "greenhouse", slug: "cloudflare" },
  { name: "Postman", website: "https://postman.com", careersUrl: "https://postman.com/company/careers", ats: "greenhouse", slug: "postman" },
  { name: "Pinterest", website: "https://pinterest.com", careersUrl: "https://pinterestcareers.com", ats: "greenhouse", slug: "pinterest" },
  { name: "Instacart", website: "https://instacart.com", careersUrl: "https://instacart.careers", ats: "greenhouse", slug: "instacart" },
  { name: "Reddit", website: "https://reddit.com", careersUrl: "https://redditinc.com/careers", ats: "greenhouse", slug: "reddit" },
  { name: "Airbnb", website: "https://airbnb.com", careersUrl: "https://careers.airbnb.com", ats: "greenhouse", slug: "airbnb" },
  { name: "Vercel", website: "https://vercel.com", careersUrl: "https://vercel.com/careers", ats: "greenhouse", slug: "vercel" },
  { name: "Block (Square)", website: "https://block.xyz", careersUrl: "https://block.xyz/careers", ats: "greenhouse", slug: "block" },
  { name: "Hudson River Trading", website: "https://hudsonrivertrading.com", careersUrl: "https://hudsonrivertrading.com/careers", ats: "greenhouse", slug: "wehrtyou" },
  { name: "Jump Trading", website: "https://jumptrading.com", careersUrl: "https://jumptrading.com/careers", ats: "greenhouse", slug: "jumptrading" },
  { name: "Scale AI", website: "https://scale.com", careersUrl: "https://scale.com/careers", ats: "greenhouse", slug: "scaleai" },
  { name: "Anduril", website: "https://anduril.com", careersUrl: "https://anduril.com/careers", ats: "greenhouse", slug: "andurilindustries" },
  { name: "Coinbase", website: "https://coinbase.com", careersUrl: "https://coinbase.com/careers", ats: "greenhouse", slug: "coinbase" },
  { name: "Discord", website: "https://discord.com", careersUrl: "https://discord.com/careers", ats: "greenhouse", slug: "discord" },
  { name: "Roblox", website: "https://roblox.com", careersUrl: "https://careers.roblox.com", ats: "greenhouse", slug: "roblox" },
  { name: "SpaceX", website: "https://spacex.com", careersUrl: "https://spacex.com/careers", ats: "greenhouse", slug: "spacex" },
  { name: "Verkada", website: "https://verkada.com", careersUrl: "https://verkada.com/careers", ats: "greenhouse", slug: "verkada" },
  { name: "Robinhood", website: "https://robinhood.com", careersUrl: "https://careers.robinhood.com", ats: "greenhouse", slug: "robinhood" },
  { name: "DoorDash", website: "https://doordash.com", careersUrl: "https://careersatdoordash.com", ats: "greenhouse", slug: "doordashusa" },
  { name: "Duolingo", website: "https://duolingo.com", careersUrl: "https://careers.duolingo.com", ats: "greenhouse", slug: "duolingo" },
  { name: "Datadog", website: "https://datadoghq.com", careersUrl: "https://careers.datadoghq.com", ats: "greenhouse", slug: "datadog" },
  { name: "Asana", website: "https://asana.com", careersUrl: "https://asana.com/jobs", ats: "greenhouse", slug: "asana" },
  { name: "Affirm", website: "https://affirm.com", careersUrl: "https://affirm.com/careers", ats: "greenhouse", slug: "affirm" },
  { name: "Lyft", website: "https://lyft.com", careersUrl: "https://lyft.com/careers", ats: "greenhouse", slug: "lyft" },
  { name: "Gusto", website: "https://gusto.com", careersUrl: "https://gusto.com/about/careers", ats: "greenhouse", slug: "gusto" },
  { name: "Dropbox", website: "https://dropbox.com", careersUrl: "https://dropbox.com/jobs", ats: "greenhouse", slug: "dropbox" },
  { name: "Twilio", website: "https://twilio.com", careersUrl: "https://twilio.com/en-us/company/jobs", ats: "greenhouse", slug: "twilio" },
  { name: "Okta", website: "https://okta.com", careersUrl: "https://okta.com/company/careers", ats: "greenhouse", slug: "okta" },
  { name: "Chime", website: "https://chime.com", careersUrl: "https://chime.com/careers", ats: "greenhouse", slug: "chime" },
  { name: "Brex", website: "https://brex.com", careersUrl: "https://brex.com/careers", ats: "greenhouse", slug: "brex" },
  { name: "Faire", website: "https://faire.com", careersUrl: "https://faire.com/careers", ats: "greenhouse", slug: "faire" },
  { name: "Airtable", website: "https://airtable.com", careersUrl: "https://airtable.com/careers", ats: "greenhouse", slug: "airtable" },
  { name: "Webflow", website: "https://webflow.com", careersUrl: "https://webflow.com/careers", ats: "greenhouse", slug: "webflow" },
  { name: "Doximity", website: "https://doximity.com", careersUrl: "https://doximity.com/about/careers", ats: "greenhouse", slug: "doximity" },
  { name: "Zscaler", website: "https://zscaler.com", careersUrl: "https://zscaler.com/careers", ats: "greenhouse", slug: "zscaler" },
  { name: "Waymo", website: "https://waymo.com", careersUrl: "https://waymo.com/careers", ats: "greenhouse", slug: "waymo" },
  { name: "GitLab", website: "https://gitlab.com", careersUrl: "https://about.gitlab.com/jobs", ats: "greenhouse", slug: "gitlab" },
  { name: "xAI", website: "https://x.ai", careersUrl: "https://x.ai/careers", ats: "greenhouse", slug: "xai" },
  { name: "Epic Games", website: "https://epicgames.com", careersUrl: "https://epicgames.com/careers", ats: "greenhouse", slug: "epicgames" },

  // ── Lever ───────────────────────────────────────────────────────────
  { name: "Palantir", website: "https://palantir.com", careersUrl: "https://palantir.com/careers", ats: "lever", slug: "palantir" },
  { name: "Spotify", website: "https://spotify.com", careersUrl: "https://lifeatspotify.com", ats: "lever", slug: "spotify" },
  { name: "Atlassian", website: "https://atlassian.com", careersUrl: "https://atlassian.com/company/careers", ats: "lever", slug: "atlassian" },
  { name: "Zoox", website: "https://zoox.com", careersUrl: "https://zoox.com/careers", ats: "lever", slug: "zoox" },
  { name: "Mistral AI", website: "https://mistral.ai", careersUrl: "https://mistral.ai/careers", ats: "lever", slug: "mistral" },

  // ── Ashby ───────────────────────────────────────────────────────────
  { name: "OpenAI", website: "https://openai.com", careersUrl: "https://openai.com/careers", ats: "ashby", slug: "openai" },
  { name: "Ramp", website: "https://ramp.com", careersUrl: "https://ramp.com/careers", ats: "ashby", slug: "ramp" },
  { name: "Notion", website: "https://notion.so", careersUrl: "https://notion.so/careers", ats: "ashby", slug: "notion" },
  { name: "Linear", website: "https://linear.app", careersUrl: "https://linear.app/careers", ats: "ashby", slug: "linear" },
  { name: "Cursor", website: "https://cursor.com", careersUrl: "https://cursor.com/careers", ats: "ashby", slug: "cursor" },
  { name: "Perplexity", website: "https://perplexity.ai", careersUrl: "https://perplexity.ai/careers", ats: "ashby", slug: "Perplexity" },
  { name: "ElevenLabs", website: "https://elevenlabs.io", careersUrl: "https://elevenlabs.io/careers", ats: "ashby", slug: "elevenlabs" },
  { name: "Supabase", website: "https://supabase.com", careersUrl: "https://supabase.com/careers", ats: "ashby", slug: "supabase" },
  { name: "Zapier", website: "https://zapier.com", careersUrl: "https://zapier.com/jobs", ats: "ashby", slug: "zapier" },
  { name: "Vanta", website: "https://vanta.com", careersUrl: "https://vanta.com/careers", ats: "ashby", slug: "vanta" },
  { name: "Confluent", website: "https://confluent.io", careersUrl: "https://careers.confluent.io", ats: "ashby", slug: "confluent" },
  { name: "Cohere", website: "https://cohere.com", careersUrl: "https://cohere.com/careers", ats: "ashby", slug: "cohere" },
  { name: "Harvey", website: "https://harvey.ai", careersUrl: "https://harvey.ai/careers", ats: "ashby", slug: "harvey" },
  { name: "Plaid", website: "https://plaid.com", careersUrl: "https://plaid.com/careers", ats: "ashby", slug: "plaid" },
  { name: "Wiz", website: "https://wiz.io", careersUrl: "https://wiz.io/careers", ats: "ashby", slug: "wiz" },
  { name: "Replit", website: "https://replit.com", careersUrl: "https://replit.com/careers", ats: "ashby", slug: "replit" },
  { name: "Character.AI", website: "https://character.ai", careersUrl: "https://character.ai/careers", ats: "ashby", slug: "character" },
  { name: "Applied Intuition", website: "https://appliedintuition.com", careersUrl: "https://appliedintuition.com/careers", ats: "ashby", slug: "applied" },

  // ── Eightfold ───────────────────────────────────────────────────────
  {
    name: "Netflix", website: "https://netflix.com", careersUrl: "https://explore.jobs.netflix.net/careers",
    ats: "eightfold", eightfold: { host: "explore.jobs.netflix.net", domain: "netflix.com" },
  },

  // ── SmartRecruiters ─────────────────────────────────────────────────
  { name: "Visa", website: "https://visa.com", careersUrl: "https://corporate.visa.com/en/jobs", ats: "smartrecruiters", slug: "visa" },
  { name: "ServiceNow", website: "https://servicenow.com", careersUrl: "https://careers.servicenow.com", ats: "smartrecruiters", slug: "servicenow" },
  { name: "Canva", website: "https://canva.com", careersUrl: "https://canva.com/careers", ats: "smartrecruiters", slug: "canva" },

  // ── Workable ────────────────────────────────────────────────────────
  { name: "Hugging Face", website: "https://huggingface.co", careersUrl: "https://apply.workable.com/huggingface", ats: "workable", slug: "huggingface" },

  // ── Rippling (public per-tenant ATS board API) ─────────────────────
  { name: "Rippling", website: "https://rippling.com", careersUrl: "https://ats.rippling.com/rippling/jobs", ats: "rippling", slug: "rippling" },

  // ── Pinpoint (public per-tenant postings.json feed) ────────────────
  { name: "Shopify", website: "https://shopify.com", careersUrl: "https://shopify.pinpointhq.com", ats: "pinpoint", slug: "shopify" },
  { name: "Snap", website: "https://snap.com", careersUrl: "https://snap.pinpointhq.com", ats: "pinpoint", slug: "snap" },

  // ── Workday ─────────────────────────────────────────────────────────
  {
    name: "NVIDIA", website: "https://nvidia.com", careersUrl: "https://nvidia.com/en-us/about-nvidia/careers/",
    ats: "workday", workday: { tenant: "nvidia", host: "nvidia.wd5.myworkdayjobs.com", site: "NVIDIAExternalCareerSite" },
  },
  {
    name: "Salesforce", website: "https://salesforce.com", careersUrl: "https://careers.salesforce.com",
    ats: "workday", workday: { tenant: "salesforce", host: "salesforce.wd12.myworkdayjobs.com", site: "External_Career_Site" },
  },
  {
    name: "Adobe", website: "https://adobe.com", careersUrl: "https://careers.adobe.com",
    ats: "workday", workday: { tenant: "adobe", host: "adobe.wd5.myworkdayjobs.com", site: "external_experienced" },
  },
  {
    name: "PayPal", website: "https://paypal.com", careersUrl: "https://careers.pypl.com",
    ats: "workday", workday: { tenant: "paypal", host: "paypal.wd1.myworkdayjobs.com", site: "jobs" },
  },
  {
    name: "Workday", website: "https://workday.com", careersUrl: "https://workday.com/en-us/company/careers",
    ats: "workday", workday: { tenant: "workday", host: "workday.wd5.myworkdayjobs.com", site: "Workday" },
  },

  // ── Amazon (own public search API — see scrapeAmazon in adapters.ts) ──
  { name: "Amazon", website: "https://amazon.com", careersUrl: "https://amazon.jobs/en/teams/internships-for-students", ats: "amazon" },

  // ── Custom portals (manual check — future adapters) ─────────────────
  { name: "Apple", website: "https://apple.com", careersUrl: "https://jobs.apple.com/en-us/search?team=internships-STDNT-INTRN", ats: "unsupported" },
  { name: "Google", website: "https://google.com", careersUrl: "https://google.com/about/careers/applications/jobs/results/?target_level=INTERN_AND_APPRENTICE,EARLY", ats: "unsupported" },
  { name: "Meta", website: "https://meta.com", careersUrl: "https://metacareers.com/jobs?is_in_page=0&sub_teams[0]=University%20Grad%20-%20Engineering%2C%20Tech%20%26%20Design", ats: "unsupported" },
  { name: "Microsoft", website: "https://microsoft.com", careersUrl: "https://apply.careers.microsoft.com/careers?domain=microsoft.com", ats: "unsupported" },
  { name: "Uber", website: "https://uber.com", careersUrl: "https://uber.com/us/en/careers/teams/university/", ats: "unsupported" },
  { name: "LinkedIn", website: "https://linkedin.com", careersUrl: "https://careers.linkedin.com/students", ats: "unsupported" },
  { name: "Snowflake", website: "https://snowflake.com", careersUrl: "https://careers.snowflake.com/us/en/university-recruiting", ats: "unsupported" },
  { name: "Tesla", website: "https://tesla.com", careersUrl: "https://tesla.com/careers/search/?type=3", ats: "unsupported" },
  { name: "Jane Street", website: "https://janestreet.com", careersUrl: "https://janestreet.com/join-jane-street/open-roles/", ats: "unsupported" },
  { name: "Two Sigma", website: "https://twosigma.com", careersUrl: "https://careers.twosigma.com/careers", ats: "unsupported" },
  { name: "Citadel", website: "https://citadel.com", careersUrl: "https://citadel.com/careers/open-opportunities/students/", ats: "unsupported" },
  { name: "TikTok", website: "https://tiktok.com", careersUrl: "https://lifeattiktok.com", ats: "unsupported" },
  { name: "Bloomberg", website: "https://bloomberg.com", careersUrl: "https://careers.bloomberg.com", ats: "unsupported" },
  { name: "Grammarly", website: "https://grammarly.com", careersUrl: "https://grammarly.com/careers", ats: "unsupported" },
  { name: "HashiCorp", website: "https://hashicorp.com", careersUrl: "https://hashicorp.com/careers", ats: "unsupported" },
];
