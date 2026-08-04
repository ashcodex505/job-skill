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

Two more capabilities, added once real companies needed them (2026-08-04):

- **`searchQuery` — type-and-submit for search-box-driven sites.** Confirmed
  live: Apple's careers site ignores a query string on initial page load
  entirely; the search only actually fires once a real input is filled and
  submitted. When a `career/browser-companies.md` entry sets `searchQuery`,
  the scraper finds the most plausible "search by role/keyword" input on the
  page (scored by placeholder/aria-label/name/id, penalizing known
  non-role filters like location/team/language typeaheads), types the query
  in, and presses Enter — still generic (no Apple-specific selector), just a
  broader interaction than "navigate and read."
- **`seasonHint` — a declared season for companies whose own postings never
  state one.** Confirmed live across Microsoft, Meta, Google, and Apple: a
  company's own careers site almost never restates a recruiting season in
  its title the way a SimplifyJobs/vansh feed listing does ("Software
  Engineer Intern" with no "Fall 2026") — see `classify.ts`'s
  `detectSeason()` and `RawJob.seasonHint`, the same mechanism the
  SimplifyJobs feed adapter uses (there it's read from the feed's own
  `terms` field; here there's no structured field to read, so you declare it
  per company instead). **Trade-off, stated plainly: this applies to every
  posting scraped from that company in that run**, so a company posting for
  multiple seasons at once (e.g. both Fall 2026 and Spring 2027 internships
  live simultaneously) will have some postings mistagged. Left unset by
  default; only set where the value is clear and worth periodically
  updating by hand as the recruiting cycle moves — see the per-company table
  below for exactly what's set and why.

## Non-generic exception: Google's dedicated extractor

Confirmed live: Google's job cards are not `<a href>` elements at all —
they're `<li class="lLd3Je">` built from Google's internal Closure/Material
JS framework, with the actual job ID embedded in a `jsdata` attribute
(`jsdata="Aiqs8c;107900969756304070;$2"` → id `107900969756304070`, which
resolves at `google.com/about/careers/applications/jobs/results/{id}`). The
generic anchor-based extractor finds **zero** anchors on this page, no
matter how long you wait for hydration — there's nothing to read.

`scrapeGoogleCareers()` in `browser-scrape.ts` is a small, narrowly-scoped
exception to the "one generic extractor, no per-company selectors" rule
above: it queries `li.lLd3Je` cards directly and parses the `jsdata`
attribute into a URL via the pure, tested `googleJobUrlFromJsData()`.
Dispatched automatically by hostname (`*.google.com`) in
`scrapeBrowserCompanies()` — no config flag needed. This mirrors the one
other precedent for bespoke logic in this codebase: `adapters.ts`'s
`scrapeAmazon()`, which also isn't a uniform ATS adapter. It's a deliberate,
justified exception, not a crack in the "generic" design — every other
company still goes through the shared reader.

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
| Grammarly | Redirects to **Superhuman** (their own acquisition)'s careers page. |
| Superhuman | `BlockedError` — page rendered almost no visible text. Unknown whether this is active blocking or just an unusual page structure; treated as "don't trust this result," not "confirmed zero jobs." |
| Bloomberg (via the Avature-hosted search URL specifically, not the bloomberg.com landing page) | **25 real postings** — titles, URLs, all clean. This is the seeded pilot in `career/browser-companies.md`. |

## Round two: Microsoft, Meta, Google, Apple (2026-08-04)

This first pass (above) tried Microsoft's *old* `careers.microsoft.com`
domain and correctly found it unworkable ("search/filter-driven, not a
simple rendered list"). Microsoft has since migrated to a new domain,
`apply.careers.microsoft.com`, discovered while investigating a real missed
posting — that migration, plus a real request to also cover Meta/Google/
Apple, is why these four got a second, deeper look:

| Company | Platform found | What works | Caveat, stated plainly |
|---|---|---|---|
| **Microsoft** | Migrated to **Eightfold** (`apply.careers.microsoft.com` — confirmed via `x-ef-*` response headers, the same platform this repo already scrapes directly for Netflix). Its `/api/apply/v2/jobs` endpoint returns `"Not authorized for PCSX"` to a plain HTTP request, even shaped exactly like our working Netflix call — a deliberate session/CSRF gate we don't attempt to bypass (see `registry.ts`'s comment). | The **generic extractor works well** once given `?domain=microsoft.com&query=software%20engineer%20intern` — real anchors, with title + location + relative posted date all in one string, once `innerText` (not `textContent`) is used to read them (see below). | Postings never state a season in the title — `seasonHint: "Fall 2026"` set explicitly, confirmed live to surface the exact real postings this investigation started from (Security & Identity, Data Platform/Analytics, AI/ML & LLM interns). |
| **Meta** | Own platform (`metacareers.com`), real `<a href="/profile/job_details/{id}">` cards. | Generic extractor works. `q=intern` surfaces real "…Intern" titled postings. | Today's top results skew PhD/Research-titled, not plain Software Engineer — `role` score 0 for those (correctly excluded per your own target-roles list, not a bug). No `seasonHint` set — results will be thin until query tuning improves or the current crop shifts toward SWE-titled roles. |
| **Google** | Own Closure/Material JS framework. Job cards are `<li class="lLd3Je">`, **not real anchors at all** — the generic extractor finds zero. Needed a dedicated extractor (see above). | Once `networkidle` wait is used (not just a fixed timeout — job cards load via a follow-up XHR), the dedicated extractor reads real cards with title + location. | Query tuning is genuinely unsolved here: `q="software engineer intern"` returns Senior/Staff-titled roles near the top, not literal internship postings, in today's live results. Infrastructure works; the query needs more iteration than this pass had time for. |
| **Apple** | Own platform (`jobs.apple.com`). A URL query param is silently ignored — the search box must be filled and submitted for real (`searchQuery` mechanism, built for this). | `search: software engineering internship` (not `"...intern"`) surfaces real, precisely on-topic results: "Software Engineering Masters Internships," "Software Undergrad Engineering Internships," etc. | None currently state a season either — no `seasonHint` set yet since none was confirmed necessary the way Microsoft's was; worth adding once a specific missed posting is diagnosed the same way. |

A root-cause bug was also found and fixed while verifying Microsoft: the
generic extractor read anchor labels with `el.textContent`, which
concatenates sibling block elements with **no separator at all** —
`"Software Engineer Intern" + "United States, Redmond" + "Posted 2 days
ago"` came out as `"...InternUnited States..."`, silently breaking
`classify.ts`'s word-boundary role/season regexes (`\bintern\b` doesn't
match `InternUnited`). Switched to `el.innerText`, which respects rendered
layout and inserts real whitespace between block-level siblings — fixes
this for every company using the generic extractor, not just these four.

Net: of this round's 4 attempts, 2 work well end-to-end today (Microsoft,
Apple), 1 has working infrastructure but an unsolved query-tuning problem
(Google), and 1 works but is currently thin on precisely-matching results
(Meta) — an honest state, not a finished one. Query tuning for
search-driven sites is inherently a moving target as each company's live
postings change; today's queries are a verified starting point, not a
permanent answer.

## Ranking of "unsupported" companies by apparent protection strength

Checked live via response headers (WAF/CDN fingerprints) before picking
targets — weakest signal first, i.e. best odds of actually working:

| Company | Signal |
|---|---|
| HashiCorp, Applied Intuition | `server: Vercel` — not a bot-management product by itself |
| Microsoft | no CDN/WAF header at all — and confirmed live: works well via browser-scan (see round two above) |
| Grammarly, Snowflake | CloudFront |
| Bloomberg | AWS ELB |
| Meta, Apple | No hard block encountered — confirmed live: both work via browser-scan (Apple needed the `searchQuery` interaction step, Meta works with a plain URL query) |
| Google | No hard block encountered, but a **non-anchor, JS-framework-driven** result structure (own dedicated extractor built for it, see above) — a different kind of difficulty than WAF strength |
| Uber | **Cloudflare** confirmed |
| Tesla, TikTok | **Akamai** confirmed — one of the most sophisticated anti-bot products that exists |
| LinkedIn | Confirmed AWS ALB + session-cookie tracking — not yet attempted |

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
