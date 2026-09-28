# CI Job Scraper and Board — As-Built Specification

**Status:** Describes the implemented system
**Last verified against the repository:** 2026-09-28
**Primary focus:** The CI scraper, committed job board, and alerting workflows

## 1. Purpose

This system finds software-engineering internships and explicit early-career/full-time roles, filters them against the candidate's policy, publishes a repository-hosted board, and creates high-signal GitHub issues for selected new roles.

The application has two related environments:

- The **local application** runs the UI, API, SQLite database, direct scraper, local browser scraper, and application tracker on the user's Mac.
- **GitHub Actions** runs a stateless copy of the CI-safe scraper. It uses committed files as durable memory, publishes board updates, and sends notifications through GitHub Issues.

This document is intentionally an as-built specification, not a proposal. The separate [improvement specification](ci-web-scraper-improvements.md) contains possible future work.

## 2. Beginner's mental model

Think of the CI system as a recurring five-stage pipeline:

1. **Collect** raw postings from official ATS endpoints, first-party endpoints, public community feeds, or the reverse-discovery directory.
2. **Normalize** every source into one shared job shape.
3. **Filter and score** jobs using the machine-readable sections in `career/profile.md` and `career/preferences.md`.
4. **Merge** the results with the previous committed board so first-seen dates, closures, and alert history survive stateless runners.
5. **Publish and notify** by rewriting the board files, committing them to `main`, and opening selected GitHub issues.

The critical design rule is:

> A missing job is considered closed only when its owning source was successfully scanned, or when a link check receives a definitive HTTP 404/410.

An adapter timeout, maintenance window, partial scan, 403, or rate limit is not evidence that a job closed.

## 3. Scope and non-goals

### In scope

- Direct public ATS/API scraping in CI.
- Three public community job feeds.
- Weekly reverse ATS discovery.
- Title classification, policy enforcement, scoring, canonicalization, and deduplication.
- The committed active/closed board state.
- Markdown board and README rendering.
- Watchlist, big-tech, source-health, policy-gap, and registry-health issues.
- Local commands that execute the same CI-safe pipeline.

### Outside the CI scraper

- The Playwright-based browser scraper in `src/scraper/browser-scrape.ts` is **local only**. It is run through the local dashboard and must not be imported into the default scraper or a CI workflow.
- The Claude-assisted company scout is local only.
- The local SQLite application database is not persistent CI state. CI sets `DATABASE_PATH=/tmp/scrape.db` and discards it after the run.
- The application/resume/credential tracking features are outside this specification.
- The scraper does not bypass authentication, CAPTCHA, CSRF/session gates, or anti-bot controls.

See [browser-scraping.md](../browser-scraping.md) for the local browser subsystem.

## 4. System topology

```text
career/*.md + registry.ts + public job sources
                        |
                        v
                 adapters.ts
                        |
                    RawJob[]
                        |
          classify.ts + normalize.ts
                        |
                NormalizedJob[]
                        |
       SQLite upsert + board merge/dedupe
                        |
      +-----------------+------------------+
      |                 |                  |
      v                 v                  v
board/jobs.json       JOBS.md           README.md
      |
      +--> new-job diff --> watch/big-tech selectors
                              |
                              v
                         GitHub Issues
```

Important implementation entry points:

| Responsibility | File |
|---|---|
| Company-to-source registry | `src/scraper/registry.ts` |
| HTTP behavior and source adapters | `src/scraper/adapters.ts` |
| Orchestration and SQLite upsert | `src/scraper/run.ts` |
| Title classification and score | `src/scraper/classify.ts` |
| Policy enforcement and dedupe | `src/scraper/normalize.ts` |
| Board state merge and rendering | `src/scraper/board.ts` |
| CLI and GitHub Actions outputs | `src/scraper/board-cli.ts` |
| Reverse discovery | `src/scraper/discover.ts` |
| Big-tech alert policy | `src/scraper/big-tech-alert.ts` |
| Watchlist parsing and matching | `src/lib/career/watchlist.ts` |
| Career markdown parsing | `src/lib/career/config.ts` |

## 5. Sources and adapters

### 5.1 Source classes

The system has four collection classes.

| Class | How it works | Closure ownership |
|---|---|---|
| Direct company adapter | A named company in `COMPANY_PORTALS` is queried through an official ATS or first-party endpoint. | The company owns its direct rows. An absent row closes only after that company scanned successfully. |
| Community feed | The scraper reads recent entries from SimplifyJobs, speedyapply, and vanshb03 repositories. | Each feed owns its rows. A feed row closes only when that feed scanned successfully and no longer contains it. |
| Reverse discovery | A rotating window of a public ATS-company directory is scanned weekly. | Absence never closes a row because a run sees only a slice. A later definitive link check can close it. |
| Local browser scan | Playwright renders configured career sites on the user's Mac. | Outside CI; currently does not deactivate a posting merely because it disappears. |

### 5.2 Network policy

All CI-safe requests use an identifying user agent, a 20-second timeout, and up to three retries for timeouts, HTTP 429, HTTP 5xx, or unexpected HTML returned by a JSON endpoint. Backoff is exponential with jitter and honors `Retry-After`, subject to a cap. A non-transient error such as a 404 is not retried.

Direct companies are interleaved by ATS and processed in a five-lane pool. Each lane waits 400 ms between companies. This avoids opening five simultaneous requests against the same shared ATS host simply because registry entries are grouped by provider. The three community feeds run in their own bounded pool concurrently with the company sweep because they use independent endpoints.

Workday's expected Saturday 02:00–07:00 America/New_York maintenance window is treated as a skip, not a failure or successful scan. Existing rows are preserved.

### 5.3 Implemented adapter families

The shared `RawJob` contract supports these source identifiers:

- Official/common ATS: Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Eightfold, BambooHR, Recruitee, Breezy, Rippling, Personio, Pinpoint, Jibe Apply, and Oracle Recruiting Cloud.
- First-party/composite sources: Amazon Jobs, Atlassian, Shopify, and Throne Science.
- Community sources: SimplifyJobs, speedyapply, and vanshb03.
- Other ingestion paths: reverse discovery, local browser, and career-ops imports.

Not every implemented adapter currently has a hand-registered company. BambooHR, for example, is also used by reverse discovery.

### 5.4 Current hand-maintained registry

As verified on 2026-09-28, `COMPANY_PORTALS` contains **140 unique companies**: **116 with CI-safe direct adapters** and **24 marked unsupported** with an explicit browser, community-feed, or manual fallback.

| Adapter | Count | Registered companies |
|---|---:|---|
| Greenhouse | 53 | Stripe, Databricks, Anthropic, Together AI, Figma, Samsara, MongoDB, Cloudflare, Postman, Pinterest, Instacart, Reddit, Airbnb, Vercel, Block (Square), Hudson River Trading, Jump Trading, Scale AI, Anduril, Coinbase, Discord, Roblox, SpaceX, Verkada, Robinhood, DoorDash, Duolingo, Datadog, Asana, Affirm, Lyft, Gusto, Dropbox, Twilio, Okta, Chime, Brex, Faire, Airtable, Webflow, Doximity, Zscaler, Waymo, GitLab, xAI, Epic Games, Abnormal AI, Chainguard, Huntress, Aidoc, Oura, PathAI, Gemini |
| Ashby | 32 | Semgrep, Abridge, Ambience Healthcare, Hippocratic AI, Owkin, Mistral AI, OpenAI, Ramp, Notion, Linear, Cursor, Perplexity, ElevenLabs, Supabase, Baseten, Zapier, Vanta, Confluent, Cohere, Harvey, Cerebras, Reflection AI, SSI, Sierra, Cognition, Physical Intelligence, Plaid, Wafer, Replit, Character.AI, Applied Intuition, Quora |
| Workday | 16 | CrowdStrike, Snap, Autodesk, Expedia, HP, Qualcomm, Yahoo, Zoom, NVIDIA, Salesforce, Adobe, PayPal, Workday, Intel, Palo Alto Networks, eBay |
| Lever | 3 | Palantir, Spotify, Zoox |
| SmartRecruiters | 3 | Visa, ServiceNow, Canva |
| Oracle Cloud | 2 | Oracle, Dell |
| Atlassian | 1 | Atlassian |
| Eightfold | 1 | Netflix |
| Workable | 1 | Hugging Face |
| Rippling | 1 | Rippling |
| Shopify composite | 1 | Shopify |
| Amazon first-party | 1 | Amazon |
| Throne HTML | 1 | Throne Science |
| Unsupported in direct CI | 24 | Wiz, Apple, Google, Meta, Microsoft, Uber, LinkedIn, Snowflake, Tesla, Jane Street, Two Sigma, Citadel, TikTok, Bloomberg, Grammarly, HashiCorp, Booking.com, Cisco, IBM, Intuit, SAP, Splunk, VMware, X (Twitter) |

“Unsupported” does not necessarily mean uncovered. Several of these companies appear through community feeds, and ten are configured for the local browser scanner. The exact declared fallback is part of the registry so approved-company coverage cannot fail silently.

### 5.5 Community feeds

Watch/full runs can ingest three independent feeds concurrently:

- SimplifyJobs internship and new-grad data.
- `speedyapply/2027-SWE-College-Jobs` markdown data.
- vanshb03 internship and new-grad data.

Feed ingestion keeps recent listings, currently using a 90-day maximum feed age where source data provides dates. Feeds are valuable for companies whose first-party sites cannot be queried anonymously, but feed coverage is not guaranteed and feed descriptions may be absent.

### 5.6 Reverse discovery

The weekly discovery workflow reads a public directory of roughly 28,000 Greenhouse, Lever, Ashby, and BambooHR boards. Each run scans at most 150 companies per ATS with eight-way concurrency. `board/discovery-cursor.json` records the next offset per ATS and wraps at the end.

Discovery results go through the same normalization and policy pipeline as registered companies. Discovery does not mark a company/source as fully scanned, because a rotating slice cannot prove that an older job disappeared.

## 6. Input configuration

### 6.1 Candidate profile

`career/profile.md` supplies the skill list used for score enrichment. Matching is deterministic and case-insensitive. Word boundaries prevent `Java` from matching `JavaScript`; symbol-bearing skills use substring matching.

### 6.2 Career preferences

Machine-readable sections in `career/preferences.md` control:

- target role phrases;
- preferred seasons and locations;
- required phrases for full-time new-grad roles;
- allowed internship seasons;
- the Summer 2027 approved-company gate;
- positive and negative title keywords; and
- an optional maximum posting age.

The file is re-read on every run. In the current configuration:

- Full-time roles must be explicit new-grad/early-career/junior/level-I variants.
- Internships and co-ops are accepted in any season, including an unknown/rolling season.
- A Summer 2027 internship must belong to the approved-company list.
- Clearly non-US-only jobs are excluded; remote, hybrid, US, ambiguous, and missing locations pass.
- Hardware, firmware, embedded, FPGA, ASIC, and PhD-only roles are rejected.
- The optional board-wide maximum posting age is disabled.

### 6.3 Watches and priority companies

- `career/watchlist.md` is app-managed. A watch contains a company (or `Any`) and space-separated words; **all** words must occur in the title.
- `career/priority-companies.md` is app-managed and feeds the frequent watch workflow.
- Amazon is always included in watch/priority mode.
- The Summer 2027 approved-company list is also included in watch mode when a direct adapter exists.

Current watches are Shopify “Software Engineering Internships Winter 2027,” Salesforce “College Grad,” and Quora “New Grad.” The files themselves remain the source of truth if this sentence becomes stale.

## 7. Raw and normalized data contracts

### 7.1 `RawJob`

Every adapter emits:

| Field | Meaning |
|---|---|
| `source` | Adapter/feed identifier. |
| `sourceId` | Provider job ID when available. |
| `company` | Display company name. |
| `title` | Provider title. |
| `location` | Structured location or `null`. |
| `url` | Application/detail URL. |
| `postedAt` | Provider-supplied posting time or `null`. |
| `description` | Optional HTML/plaintext description. |
| `seasonHint` | Optional feed/browser season signal, used only if the title lacks a season. |

### 7.2 `NormalizedJob`

Normalization adds:

- `dedupeKey`;
- `roleType` (`internship`, `new_grad`, or the internal unknown state);
- detected `season`;
- total `score` and component `breakdown`;
- `matchedSkills`; and
- a plain-text description capped at 10,000 characters for local persistence.

Descriptions are not copied into the committed board state.

## 8. Eligibility and scoring behavior

### 8.1 Processing order

For every raw posting, the pipeline:

1. Trims and whitespace-normalizes the title.
2. Rejects empty titles.
3. Rejects hardware, firmware, embedded, and PhD-only restrictions.
4. Detects role type and season.
5. Applies negative keywords and seniority exclusion.
6. Requires an engineering/target-role signal or an explicit early-career signal.
7. Applies the US/remote/hybrid location rule.
8. Rejects expired graduation-eligibility windows.
9. Applies internship, new-grad, and Summer 2027 policy gates.
10. Optionally applies maximum posting age.
11. Computes skill matches and the final score.

`npm run job:explain` exposes the rejection reason for diagnosis.

### 8.2 Role and season detection

- `intern`, `internship`, and `co-op` indicate an internship.
- New-grad phrases include new grad/graduate, early career, entry level, junior, level-I/1, and equivalent SWE/SDE/developer forms.
- An explicit season such as `Summer 2027` wins.
- An internship title with only a year gets a bare year such as `2027`.
- A new-grad title with a year gets `2027 New Grad`.
- A source hint is used only when the title has no season.
- A graduation-date range is eligibility, not the job's recruiting season.

### 8.3 Score

The score is deterministic and capped at 100:

| Component | Maximum behavior |
|---|---:|
| Target/built-in role match | 40 |
| Explicit internship/new-grad signal | 30 |
| Season present and preferred | 25 |
| Preferred location | 5 |
| Positive title keyword | 10 |
| Profile skill coverage | 25 |

The theoretical components exceed 100, so the stored result is capped. A posting must reach 30 before career-policy checks. Hard exclusions always win over a high score.

### 8.4 Deduplication

The primary key is `<source>:<provider-id>`. If no provider ID exists, the system hashes the URL or company/title/location fallback.

Cross-source deduplication additionally canonicalizes URLs by:

- lowercasing hosts and normalizing paths;
- removing tracking query parameters while preserving stable job-ID parameters;
- treating Ashby application/embed routes as the same posting;
- normalizing Workday route variants to a requisition identity; and
- applying other provider-specific URL normalization.

When a direct adapter and community feed provide the same URL, the direct identity wins. This prevents source/key flipping across full and feed-only runs.

## 9. Board state and lifecycle

### 9.1 Canonical inventory

`board/jobs.json` is the exhaustive, machine-readable inventory of the current board. It has this shape:

```json
{
  "updatedAt": "ISO-8601 timestamp",
  "jobs": ["active BoardJob records"],
  "closed": ["recently closed records"]
}
```

An active `BoardJob` contains identity, source, company, title, location, URL, season, role type, score, matched skills, optional score breakdown, optional provider posting date, and `firstSeenAt`.

A closed record keeps its identity, display fields, original first-seen time, closure time, and normally its URL. Closed records are retained for seven days.

This spec does **not** copy every active posting because that would create a second, immediately stale inventory. To inspect every currently stored job, read `board/jobs.json`. `JOBS.md` is the human view, but each long category is intentionally capped at 400 displayed rows.

### 9.2 Merge semantics

- Existing `firstSeenAt` survives refreshes, source changes, close/reopen cycles, and stateless CI runs.
- The earliest valid provider date observed is retained and clamped so a job cannot appear to have been posted after it was first seen.
- Jobs from unscanned or failed companies/sources carry forward unchanged.
- Jobs missing after a successful owning-source scan move to `closed`.
- A full-board link check moves only definitive 404/410 URLs to `closed`; timeouts, 403s, 429s, and other ambiguous statuses keep the job.
- Current restrictions are reapplied to carried-forward rows, so a policy change cleans old board state even during partial runs.

### 9.3 Current board snapshot

Snapshot from `board/jobs.json`, last updated **2026-09-22 22:24:49 UTC**:

- **1,839 active roles** across **717 displayed company names**.
- **187 recently closed roles** retained in the seven-day ledger.
- **1,265 internships** and **574 new-grad roles**.
- First-seen history spans 2026-07-05 through 2026-09-22 in this snapshot.

By source:

| Source | Active jobs |
|---|---:|
| SimplifyJobs | 863 |
| speedyapply | 629 |
| vanshb03 | 112 |
| Greenhouse | 98 |
| Lever | 46 |
| Reverse discovery | 39 |
| Ashby | 19 |
| Workday | 16 |
| Amazon | 10 |
| Rippling | 4 |
| Oracle Cloud | 2 |
| Atlassian | 1 |

By detected season:

| Season | Active jobs |
|---|---:|
| Unknown/unstated | 959 |
| Winter 2026 | 170 |
| Bare 2027 | 161 |
| Fall 2026 | 122 |
| Summer 2027 | 93 |
| Spring 2027 | 92 |
| Winter 2027 | 88 |
| Summer 2026 | 83 |
| 2027 New Grad | 31 |
| All other detected values | 40 |

Largest displayed company groups in the snapshot are TikTok (128), Palantir (64), Tesla (60), L3Harris Technologies (47), RTX (32), American Express (30), Amazon (25), ByteDance (22), Qorvo (21), and General Dynamics Mission Systems (19).

The 717-name count includes feed-provided companies and naming variants; it is not the same as the 139-company curated registry.

## 10. Publication

Every board run rewrites:

- `board/jobs.json` — canonical active/closed state;
- `JOBS.md` — human board grouped into new, internship, new-grad, other, and recently closed sections; and
- the marker-delimited top-20 board section in `README.md`.

A role receives a `🆕` badge when its `firstSeenAt` is less than 13 hours before the current board timestamp. Ordering uses match score for main sections and provider posting time (falling back to first seen) for fresh/alert views.

CI commits `JOBS.md`, `README.md`, and `board/` with `[skip ci]`. Workflows share the `job-board` concurrency group without cancellation. Before pushing, a workflow rebases on `main`; a real content conflict causes it to drop the regenerable board commit so a later run can self-correct.

## 11. CI workflows

### 11.1 Job board (`job-board.yml`)

- Schedule: 05:23 and 17:23 UTC daily, plus manual dispatch.
- Command: `npm run board`.
- Behavior: scans the full supported registry and feeds, performs link checking, writes summaries/alert payloads, creates selected alerts, commits the board, and ensures the watch workflow is enabled.
- Permissions: contents, issues, and actions write.
- Timeout: 20 minutes.

### 11.2 Feed watch (`watch.yml`)

- Schedule: an hourly `:07` base plus month-aware `:37` runs. The intended totals are 43 runs/day in 31-day months, 45 in 30-day months, and 48 in February.
- Also runs on changes to the watchlist, priority-company list, or preferences file, and supports manual dispatch.
- Command: `npm run board -- --watch`.
- Scope: Amazon, watched companies, priority companies, approved companies with direct adapters, and all three community feeds.
- Link checking is disabled for this partial/frequent run.
- Also manages open source-health and policy-gap issues and records recovery gaps over 90 minutes in the run summary.
- Timeout: 20 minutes.

### 11.3 Reverse discovery (`discovery.yml`)

- Schedule: Sunday 09:17 UTC, plus manual dispatch.
- Command: `npm run board -- --discover --no-linkcheck`.
- Scope: rotating slices of the public ATS directory only; no curated registry or community feeds.
- Commits the cursor and board results.
- Its alert steps are older than the main job-board/watch implementation: they create issues directly and do not run `alert:ack` or search existing issues by fingerprint. This is a documented reliability gap, not intended behavior; see IMP-013 in the improvement spec.
- Timeout: 20 minutes.

### 11.4 Registry check (`registry-check.yml`)

- Schedule: 06:13 UTC on the first day of each month, plus manual dispatch.
- Runs `npm run scrape:coverage` and `npm run scrape:check`.
- Updates or creates a `maintenance` issue if one or more registered portals fail.
- Timeout: 20 minutes.

All workflows use Node 24 and `npm ci` on Ubuntu.

## 12. Alerts and health reporting

### 12.1 Urgent watch alerts

Only jobs new to this board cycle are considered. A job must satisfy one of the configured watches, and its canonical URL must not be present in `board/alerted.json`. CI creates an assigned `urgent` issue and then records the alert through `npm run alert:ack`.

### 12.2 Big-tech/high-signal alerts

A new job must:

- be an internship or new-grad role;
- belong to the static big-tech/unicorn list or the live approved-company list;
- not belong to the quant, banking, or card-network exclusion list;
- not have a trading/quant/banking-style title;
- have a known provider date no more than seven days old;
- not already be an urgent match; and
- not already exist in the alert ledger.

In addition to the static and live approved-company lists, the selector reads `board/scout-companies.json`, the committed output of the local-only company scout.

### 12.3 Idempotency

Alert bodies contain a deterministic fingerprint. In the main job-board and watch workflows, CI searches existing issues for that marker. The committed `board/alerted.json` ledger is a second guard keyed by canonical URL and retains alert records for 180 days. These two workflows acknowledge a notification only after its issue is confirmed to exist.

The reverse-discovery workflow does not yet use those acknowledgment/search steps. A discovery-created alert can therefore remain absent from the shared ledger or be duplicated after a retry. This exception is tracked as IMP-013.

### 12.4 Source and policy health

The frequent watch workflow keeps one open `scraper-health` issue describing current direct-source failures and closes it after recovery. It similarly maintains a `policy-gap` issue for likely early-career direct-source titles rejected because the strict required-title list lacks their phrase.

The monthly registry doctor separately detects bad slugs or moved portals.

## 13. Commands and run modes

| Command | Purpose |
|---|---|
| `npm run scrape` | Run the default scraper and persist into local SQLite. |
| `npm run scrape -- --company Stripe` | Run selected direct companies. |
| `npm run board` | Full scrape, link check, and board render. |
| `npm run board -- --company Stripe` | Partial direct-company board refresh; link check is disabled automatically. |
| `npm run board -- --watch` | Frequent watch/priority/approved direct scan plus feeds. |
| `npm run board -- --priority` | Direct-only fast lane available for local use. |
| `npm run board -- --discover --no-linkcheck` | Reverse-discovery slice. |
| `npm run scrape:check` | Verify registered portal slugs/endpoints. |
| `npm run scrape:coverage` | Summarize approved-company coverage and fallbacks. |
| `npm run job:explain` | Explain why a posting was accepted or rejected. |
| `npm run alert:ack -- --payload <file> --type <type>` | Record a successfully delivered alert. |

## 14. Failure behavior and invariants

The system must preserve these invariants:

1. One company/source failure does not abort other sources.
2. Failed or skipped sources do not close their prior jobs.
3. Partial scans do not close jobs owned by sources outside the partial scope.
4. Reverse discovery absence never implies closure.
5. Only 404/410 is definitive during link checking.
6. Direct-source identity wins over feed identity for the same canonical URL.
7. A close/reopen cycle preserves the original first-seen date.
8. Current hard restrictions apply to both fresh and carried rows.
9. In the main job-board and watch workflows, notification creation is acknowledged only after the GitHub issue operation succeeds. Reverse discovery is the known exception tracked in IMP-013.
10. The local credential/application database is never read by CI.
11. Browser automation remains isolated from CI-safe imports.

## 15. Testing and verification

The scraper has focused Vitest coverage for adapters, normalization/classification, board merging, coverage resolution, alert selection/payloads, watch health, local/browser alert behavior, browser settings, company scouting, and Google application readiness.

Before changing scraper behavior, run:

```bash
npm test
npm run lint
npm run build
```

For a live adapter change, also run a narrow source check such as:

```bash
npm run scrape -- --company Stripe
npm run scrape:check
```

Live checks contact third-party services and can be affected by maintenance or rate limits; unit tests should cover deterministic transformation logic.

## 16. Safe extension procedures

### Add a direct company

1. Confirm the real ATS/provider and public endpoint; do not infer a slug from the marketing careers URL alone.
2. Prefer an existing direct adapter over browser automation.
3. Add the company to `COMPANY_PORTALS` with careers URL and required provider metadata.
4. Run a narrow live scrape and the registry doctor.
5. Add/update adapter or registry tests.
6. If the company is approved or high priority, update the appropriate career configuration through its intended UI/file owner.

### Add an adapter

1. Implement an adapter that emits only `RawJob[]`.
2. Use the shared timeout/retry helpers and polite pagination limits.
3. Add the source literal and `ADAPTERS` mapping.
4. Add fixture-driven parser tests and failure tests.
5. Confirm closure ownership and whether the source supplies descriptions, dates, locations, and stable IDs.
6. Update this specification and coverage documentation.

### Change policy

Policy text is executable configuration. Modify the recognized markdown section, add tests for accepted and rejected examples, run the board on a controlled sample, and expect carried rows to be filtered on the next merge.

## 17. Known design constraints

- The board is feed-heavy; community sources account for most active rows.
- Company names are display strings, so aliases/capitalization can split one real company into multiple groups.
- Many active jobs have no detected season because internships currently allow `Any`.
- The board-wide posting-age filter is currently disabled, so old provider postings can remain if their source still exposes them and the URL remains live.
- Not all sources provide descriptions, accurate posted dates, or structured locations; the system deliberately avoids treating missing data as proof of ineligibility.
- `JOBS.md` is a curated human rendering, not the exhaustive state file.
- GitHub cron is best-effort and can drift.
- Board commits can be dropped on a rebase conflict; a later run is expected to regenerate the state.

## 18. Related documentation

- [Architecture](../architecture.md)
- [Scraper coverage](../scraper-coverage.md)
- [Browser scraping](../browser-scraping.md)
- [GitHub Actions budget](../actions-budget.md)
- [Career configuration guide](../../career/README.md)
- [Current human job board](../../JOBS.md)
- [Current canonical board state](../../board/jobs.json)
