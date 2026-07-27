# Browser scraping (headless-browser scan)

A second, deliberately separate scraping mechanism from everything documented
in [architecture.md](architecture.md). Every adapter in `src/scraper/adapters.ts`
calls a public JSON API — this feature exists for the handful of companies
that don't have one at all (Google, Apple, Meta, and similar), where the only
way to see open roles is to render the page the way a browser does.

## Why this is a separate system, not just another adapter

1. **It only ever runs on your own machine, never in CI.** Every other source
   in this repo (`registry.ts` adapters, the community feeds, reverse
   discovery) is scheduled by `.github/workflows/*.yml` and runs on
   GitHub-hosted runners. Browser scraping is triggered exclusively by
   `src/components/browser-scan-panel.tsx` polling
   `POST /api/scrape/browser` while the dashboard is open in a browser tab —
   there is no workflow file for it and there never should be one.
   `src/scraper/browser-scrape.ts` must never be imported by `run.ts`'s
   default path, `board-cli.ts`, or anything `.github/workflows/` reaches.

2. **Why local-only is the right call, not just a preference.** A
   GitHub Actions runner's IP is a well-known datacenter/cloud range —
   exactly the kind of address anti-bot systems distrust most. Your own
   residential IP doesn't carry that flag. Running this from CI would very
   plausibly get the runner IP range blocked faster than it would ever get
   useful data.

3. **It actively works around anti-bot measures, and that's a real,
   deliberate decision, not a detail.** Calling a documented public JSON API
   (everything else in this repo) and presenting a browser UA specifically to
   defeat a WAF's headless-browser fingerprinting are different categories of
   action — the former is unambiguous; the latter carries real ToS and
   rate-limit exposure that is yours to accept, which is why this shipped
   only after explicit sign-off, not by default.

## What it's ported from, and how it's better

The extractor (`src/scraper/browser-scrape.ts`) is a TypeScript port of
[career-ops](https://github.com/santifer/career-ops)'s `browser-extract.mjs`
— a **generic** reader, not per-company CSS selectors: launch headless
Chromium, let the page hydrate, then read every visible `<a href>` not inside
`nav`/`header`/`footer`, filtered through a stopword list (drops "Login,"
"Privacy," "Careers," etc.). Two details ported exactly because career-ops's
own code comments explain they're load-bearing, not incidental:

- **A real desktop Chrome User-Agent, not Playwright's default.** Playwright's
  default headless UA contains the literal string `"HeadlessChrome"`, which
  Cloudflare-class WAFs detect and block outright.
- **A jittered delay between companies** (2–4s, randomized) — a fixed-cadence
  request pattern is itself a bot fingerprint, separate from raw request
  rate.

Three things this version does that career-ops's doesn't:

1. **Explicit blocked-page detection (`BlockedError`).** career-ops's version
   silently returns an empty job list whether a company genuinely has zero
   open roles or the request got walled by a CAPTCHA/challenge page — those
   are not the same outcome and must never look identical to a caller. This
   version checks the rendered title/text against a list of known challenge-page
   signatures (`"Just a moment"`, `"Access Denied"`, `"px-captcha"`, Akamai
   reference-ID patterns, ...) and also flags a page that rendered almost no
   visible text at all. A block throws instead of returning `[]`, so it's
   never mistaken for a real result — confirmed live: scanning Superhuman's
   careers page correctly threw `BlockedError` rather than silently reporting
   zero postings.
2. **Output is `RawJob[]` directly**, so results flow through the exact same
   `classifyTitle`/`normalizeJob`/career-policy pipeline as every JSON
   adapter — `career/preferences.md` and `career/profile.md` apply
   automatically, with zero separate translation layer.
3. **Before trusting a browser-scraped result, check what it actually
   found.** This paid off immediately: scanning Applied Intuition's careers
   page surfaced postings hosted on `jobs.ashbyhq.com/applied/` — meaning
   Applied Intuition runs on Ashby and never needed browser scraping at all.
   It's now a normal `registry.ts` entry (`ats: "ashby", slug: "applied"`),
   which is strictly better: a real API is faster, cheaper, and far less
   fragile than rendering a page every time. **Always check whether a
   browser-scraped listing's URLs resolve to a known ATS domain
   (`ashbyhq.com`, `greenhouse.io`, `lever.co`, `myworkdayjobs.com`,
   `avature.net`, ...) before adding a company here — a real adapter is
   always the better outcome when one exists.**

## What's deliberately NOT ported

career-ops's `jd` mode (fetch full description text for one posting page) —
this repo only ports `listing` mode (title + URL). Fetching a description
would mean one browser page-load per *posting*, not per *company* — a much
bigger multiplier on an already-heavy operation. Descriptions stay `null` for
browser-sourced jobs; the skill-match score just doesn't get a boost from
them, same as any adapter without a description field (SmartRecruiters,
Workable, Eightfold, ...).

## Real results from building this (2026-07-27)

Confirmed live, not simulated:

| Company tried | Result |
|---|---|
| HashiCorp | Page is now just a redirect stub to **IBM's** careers search (HashiCorp was acquired by IBM) — no real listing to scrape here. |
| Applied Intuition | 271 real job links found — then discovered they run on Ashby; moved to `registry.ts` as a real adapter instead. |
| Microsoft | 1 link found (a nav "Go to home page" link) — their careers portal is search/filter-driven, not a simple rendered list; a generic link-reader doesn't work here. |
| Grammarly | Redirects to **Superhuman** (their own acquisition)'s careers page. |
| Superhuman | `BlockedError` — page rendered almost no visible text. Unknown whether this is active blocking or just an unusual page structure; treated as "don't trust this result," not "confirmed zero jobs." |
| Bloomberg (via the Avature-hosted search URL specifically, not the bloomberg.com landing page) | **25 real postings** — titles, URLs, all clean. This is the seeded pilot in `career/browser-companies.md`. |

Net: of 6 real attempts, 1 worked well as intended (Bloomberg), 1 revealed a
better solution than itself (Applied Intuition → real Ashby adapter), 1
correctly refused to report a false negative (Superhuman), and 3 simply
don't have a scrapeable listing this way (HashiCorp/Grammarly redirect
elsewhere, Microsoft needs real interaction). That hit rate is realistic and
expected for a generic reader against arbitrary, unknown page structures —
it is not a universal solution, and it was never going to be.

## Ranking of "unsupported" companies by apparent protection strength

Checked live via response headers (WAF/CDN fingerprints) before picking
targets — weakest signal first, i.e. best odds of actually working:

| Company | Signal |
|---|---|
| HashiCorp, Applied Intuition | `server: Vercel` — not a bot-management product by itself |
| Microsoft | no CDN/WAF header at all |
| Grammarly, Snowflake | CloudFront |
| Bloomberg | AWS ELB |
| Uber | **Cloudflare** confirmed |
| Tesla, TikTok | **Akamai** confirmed — one of the most sophisticated anti-bot products that exists |
| Google, Meta, Apple, LinkedIn | Hardest tier: confirmed Cloudflare / AWS ALB+session-cookie tracking / fully client-hydrated SPA respectively — save for last, if ever |

## How to add a company

Two options, both end up in `career/browser-companies.md` (app-managed —
don't hand-edit it, your changes get overwritten by the next dashboard
add/remove):

1. **Dashboard** (recommended): the "Browser scan" panel on the main page —
   enter a name and the careers URL, click Add.
2. **API directly**: `POST /api/browser-companies` with
   `{ "name": "...", "careersUrl": "..." }` while the local server is running.

Before adding a company, it's worth manually opening its careers page and
skimming the rendered HTML (view-source or devtools) for any URL containing
a known ATS domain — if you find one, that company belongs in
`src/scraper/registry.ts` as a real adapter, not here.

## Operational notes

- **Cadence:** the dashboard panel polls every 30 minutes while open (vs. the
  existing watchlist panel's ~10 min) — a headless page render costs real
  seconds, not milliseconds, so this is deliberately slower.
- **Sequential, not concurrent**, unlike the JSON adapters' 5-lane pool — each
  company here is a full browser context + page render, a much heavier unit
  of work, and running several at once on a machine you're also using is a
  worse trade than a few extra seconds of wall time.
- **No deactivation-on-absence yet.** Unlike the main registry, a
  browser-scraped posting that disappears doesn't currently get marked
  inactive — it just stops being refreshed. Acceptable for a first version;
  worth revisiting if this list grows.
- **Not wired into GitHub Issue notifications.** Local watch-scan (the
  existing pattern this borrows from) only ever surfaces new matches in the
  dashboard UI directly — never fires a `gh issue create`, since CI is the
  only thing with a `GH_TOKEN` and a reason to post one. Browser-scraped
  matches follow the same rule: visible next time you look at the dashboard,
  not a phone notification. Wiring a local `gh issue create` call into
  `POST /api/scrape/browser` is a reasonable fast-follow if you want it, but
  wasn't built here without being asked for specifically.
