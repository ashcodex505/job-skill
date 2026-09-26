# Resume Tracker

A local-first Mac app for the 2026–2027 job hunt: track every application,
resume version, and job-site login (encrypted), and discover SWE new-grad /
Summer 2027 internship postings straight from company ATS APIs.

- **Dashboard** — applied / active / interviews / offers / rejections, next
  actions, recent activity, pipeline breakdown.
- **Applications** — sortable/filterable table + Kanban board, detail drawer
  with a full status timeline, quick status updates, linked resume
  preview/download, and per-application credentials with reveal/copy.
- **Job Discovery** — a built-in scraper pulls SWE early-career roles from
  45+ companies (Stripe, OpenAI, Anthropic, NVIDIA, Salesforce, Adobe,
  DoorDash, Datadog, …) via official Greenhouse/Lever/Ashby/Workday/
  SmartRecruiters/Workable APIs, scores them against your profile and target
  seasons, and one click saves a role into the tracker.
- **Resumes** — versioned library with PDF upload, preview, tags, archive;
  every application records exactly which version you submitted.
- **Encrypted credentials** — AES-256-GCM, key in the macOS Keychain (or a
  master-password mode). Passwords are never stored or logged in plaintext
  and never leave your machine. Details: [docs/security.md](docs/security.md).
- **Simplify.jobs import** — apply with the Simplify Copilot extension as
  usual, then export your Simplify tracker to CSV and hit **Import** on the
  Applications page. New applications are created, statuses sync forward,
  re-imports never duplicate.
- **Career-ops-style personalization** — [`career/profile.md`](career/profile.md)
  and [`career/preferences.md`](career/preferences.md) tell the scraper who
  you are and what to hunt for; postings are scored against your skills
  (descriptions included) so the best-fit roles rank first.

Everything lives in a local SQLite database (`data/`, git-ignored). No
accounts, no cloud — Supabase Storage is an optional add-on for resume files
only. Stack and decisions: [docs/architecture.md](docs/architecture.md).

## Setup (from scratch)

Requires Node 20+ (`brew install node`).

```bash
git clone <your-repo-url> resume-tracker && cd resume-tracker
npm install
npm run db:seed        # applies migrations + demo data (skip if you want it empty)
npm run dev            # http://localhost:3000
```

That's it — no env file needed. Optional configuration: `cp .env.example .env.local`.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | migrate + start the dev server |
| `npm run start` | migrate + start the production server (after `npm run build`) |
| `npm run scrape` | run the job scraper (all companies) |
| `npm run scrape -- --company Stripe --company OpenAI` | scrape specific companies |
| `npm run scrape -- --json out/jobs.json` | also export normalized jobs as JSON |
| `npm run board` | scrape + regenerate JOBS.md and the README job board (`--no-linkcheck` to skip URL probing) |
| `npm run board -- --watch` | lightweight watchlist scan (watched companies + SimplifyJobs feed) |
| `npm run scrape:check` | slug doctor: verify every registry portal responds and count postings |
| `npm test` | unit tests (encryption, scraper classification/dedupe, status logic) |
| `npm run db:migrate` / `db:generate` / `db:seed` | drizzle migrations / codegen / seed |
| `npm run app:build` | package the Mac app into `dist/` |

## Open it from Spotlight (Mac app)

```bash
npm run app:build -- --install
```

This builds the production bundle and installs **Resume Tracker.app** into
`/Applications`. Press ⌘-Space, type "Resume Tracker", hit Enter: the app
starts the local server (port 3141, only if it isn't already running) and
opens the UI in your browser. Server logs go to `data/app.log`.

First launch note: macOS Gatekeeper may ask you to confirm opening an
unsigned app (right-click → Open the first time).

## Credential vault

On macOS the encryption key is created automatically and stored in your login
Keychain — there is nothing to set up; the first credential you save just
works. Prefer a master password instead? Set `ENCRYPTION_MODE=master` in
`.env.local` and unlock the vault from **Settings** (first unlock sets the
password). Either way: AES-256-GCM, per-record salts in master mode, and a
clear error (never data corruption) on a wrong key. Full model:
[docs/security.md](docs/security.md).

## Resume file storage

Default is local disk (`data/resumes/`) — nothing to configure. To use
Supabase Storage's free tier instead:

1. Create a project at [supabase.com](https://supabase.com), then a **private**
   bucket named `resumes` (Storage → New bucket).
2. In `.env.local`:
   ```
   RESUME_STORAGE_DRIVER=supabase
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service role key>   # Settings → API
   SUPABASE_BUCKET=resumes
   ```
3. Restart. New uploads go to Supabase; each file records which driver stored
   it, so existing local files keep working.

Credentials/passwords are **never** stored in Supabase — resume files only.

## Job scraper

`npm run scrape` (or the **Scrape now** button in Job Discovery) calls the
official public jobs APIs behind each company's careers page — Greenhouse,
Lever, Ashby boards and Workday career-site endpoints — with rate limiting
and an identifying User-Agent. Throne and Shopify also read public careers
HTML without browser execution. No CAPTCHA/auth bypassing.
Titles are filtered for SWE intern/new-grad relevance (senior/staff/manager
roles excluded), tagged with a season (e.g. "Summer 2027") and a 0–100
relevance score, deduped by provider job ID, and stored locally. Companies
with bespoke portals (Google, Apple, Meta, Amazon, …) appear in the registry
with deep links to their early-career pages for manual checks.

Per-run results (companies scanned, new jobs, per-company errors) are in
**Settings → Scraper runs**.

### Personalization (career-ops style)

The scraper reads two human-editable markdown files on every run
(see [career/README.md](career/README.md)):

- **`career/profile.md`** — your skills (keep them matching your resume's
  wording). Each posting's title + description is checked against them; the
  match adds up to +25 to the job's match percentage, and the matched skills
  show up in the Discovery tooltip (e.g. `76% (4 skills)`).
- **`career/preferences.md`** — target roles, seasons, preferred locations,
  extra positive keywords, and hard exclusions layered onto the built-in
  intern/new-grad filter.

**Settings** shows exactly what was parsed. This is the same profile-driven
filtering idea as the [career-ops](https://github.com/santifer/career-ops)
system, implemented deterministically (keywords, not LLM calls) so it runs
offline and free.

### Security and healthcare company coverage

The [security and healthcare target catalog](career/security-healthcare-targets.md)
contains 17 researched companies, official careers links, growth/ownership
evidence, and verified collection routes, including CrowdStrike, Palo Alto
Networks, Throne Science, and Baseten. Baseten is prioritized for new-grad
inference, distributed-systems, infrastructure, and FDE opportunities that do
not require prior ML research/model-training experience. The approved and
priority lists enable these companies in
the existing scheduled watcher after push. Throne uses a dedicated public HTML
adapter; the other targets use supported ATS APIs. Current preferences include
new-grad/junior/Engineer I technical roles (including AI and distributed systems)
and internships in any season, including Fall 2027 and unspecified dates.
Seniority, location, and the Summer 2027 company allowlist still apply.

### Import from Simplify.jobs

Simplify's Copilot extension only writes to Simplify's own backend (no public
API/webhooks), so the integration is import-based: **Simplify tracker →
Export CSV → Applications → Import**. Rows are matched against existing
applications by posting URL or company+title; statuses only move forward
(a stale CSV can't downgrade your pipeline), imported rows are tagged
`simplify`, and every change lands in the status timeline. Re-import after
each application session — it's idempotent. Generic CSVs (Sheets/Notion
trackers) with company + title columns also work.

### Google Sheets application mirror

When Google Sheets sync is configured, the local Applications tracker remains
the source of truth and `Sheet1` is refreshed after Simplify CSV imports,
application creation or editing, status changes, Discovery saves, and deletes.
Google failures are recorded but never roll back local changes. Settings shows
the last result and includes a **Sync now** button; `npm run sheets:sync` runs
the same full mirror from the terminal.

Create a Google service account, enable the Google Sheets API, share the target
spreadsheet with the service account's `client_email` as Editor, and add these
values to `.env.local` (never commit the real credential):

```env
GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=<base64-encoded-service-account-json>
GOOGLE_SHEETS_SPREADSHEET_ID=<spreadsheet-id>
GOOGLE_SHEETS_TAB=Sheet1
GOOGLE_SHEETS_DEFAULT_APPLICATION_EMAIL=<email-used-for-applications>
```

### Editing your profile in plain English

If the Claude Code CLI is installed (`npm i -g @anthropic-ai/claude-code`),
the career card in **Settings** gains a text box: type things like
*"add Rust and Go to my skills"*, *"exclude defense companies"*, or
*"I also want Fall 2027 internships"* and the app runs `claude -p` locally to
rewrite `career/profile.md` / `career/preferences.md` for you. Updates are
validated (a bad edit can never leave the scraper with an empty config) and
land in git like any other change. No CLI? Just edit the files by hand — the
scraper doesn't depend on Claude.

### Auto-updating job board (every 12 hours)

[`.github/workflows/job-board.yml`](.github/workflows/job-board.yml) runs the
scraper twice a day in CI (jobscanner-style), regenerates **[JOBS.md](JOBS.md)**
— the full board with an **Apply** link per role — refreshes the *Top job
matches* section at the bottom of this README, and commits the result.
`board/jobs.json` is committed alongside so "first seen" dates and 🆕 badges
survive between runs. Run it on demand with `npm run board` locally or via
the Actions tab (`workflow_dispatch`). The CI run uses a throwaway database —
your local data and credentials are never involved.

Each run also link-checks posting URLs (definitive 404/410s move to the
board's "Recently closed" section), writes a run summary with the new-jobs
table to the Actions page, and creates a separate permanent **"🆕 New job
matches"** issue (label `job-alert`) whenever a cycle finds new roles — watch
the repo to get those as notifications. Previous alert issues are never edited
or deleted, so GitHub's issue list becomes a newest-first archive of scrape
runs. Jobs inside every issue are ordered by provider posting time from newest
to oldest, include the exact UTC time and relative age, and bold jobs posted
within the last five hours with a 🚨 marker.

### Watchlist & urgent alerts

The **Watchlist** panel at the top of the dashboard is the only place watches
are added or removed (they're stored in the app-managed
[career/watchlist.md](career/watchlist.md)). A watch is a company (or "Any")
plus keywords, e.g. *Google — new grad software engineer*. Coverage for
anti-bot portals (Google, Amazon, Meta, Apple, …) comes from the MIT-licensed
[SimplifyJobs community feeds](https://github.com/SimplifyJobs/New-Grad-Positions),
which also supply true posted dates.

When a matching role first appears: it shows red-flagged in the dashboard
panel (which re-checks every 5 minutes while the app is open), gets a
🔴 **"🚨 Watchlist alerts"** section at the top of JOBS.md and the README
board, and [watch.yml](.github/workflows/watch.yml) — an **hourly** light
scan of just your watched companies + the feed — files a new issue titled
`🚨 URGENT: <company> — <role>` (label `urgent`), which GitHub pushes to your
phone. Adding or removing a watch **auto-commits and pushes**
`career/watchlist.md` (pathspec-scoped commit, rebase-and-retry on rejection),
so CI always has your latest watches with no manual git work — the dashboard
shows a warning banner only if that sync fails. Note the push carries any
other local commits on `main` along with it.

Run policy: with an **empty watchlist the workflow disables itself** — no
hourly runs at all. Adding a watch in the dashboard re-enables it via the
GitHub API and **dispatches an immediate scan**; removing your last watch
disables it again (the 12h job-board run re-syncs this state as a backstop
if the app-side toggle ever fails). GitHub cron is best-effort, so "hourly"
can occasionally drift. Alert issues/comments **@mention you**, so they push
to the GitHub mobile app by default (no special notification settings
needed).

## Tests & verification

```bash
npm test           # 45 unit tests
npm run build      # type-safe production build
npm run scrape -- --company Stripe   # live end-to-end scraper check
```

Manual smoke test: `npm run dev` → add a resume with a PDF → add an
application linked to it → save a credential, reveal and copy it → update the
status twice and check the timeline → run a scrape and save a discovered job.

## Project layout

See [docs/architecture.md](docs/architecture.md) for the module map, data
model, and the reasoning behind the stack (Next.js + Drizzle/SQLite,
TypeScript scraper, shell-bundle Mac app instead of Tauri/Electron).

<!-- JOB-BOARD:START -->
## 🎯 Top job matches right now

![open roles](https://img.shields.io/badge/open%20roles-1677-blue) ![new this cycle](https://img.shields.io/badge/new%20this%20cycle-1-brightgreen) ![updated](https://img.shields.io/badge/updated-2026--09--26-informational)

Updated **2026-09-26 20:00 UTC** · **[Full job board ➜ JOBS.md](JOBS.md)**

| Company | Role | Location | Season | Match | Posted | First seen | Apply |
|---|---|---|---|---|---|---|---|
| Tesla | Mobile Application Software Engineer Intern - Energy Engineering | Palo Alto, CA | Winter 2027 | 100% | 2026-09-26 | 2026-09-26 | [**Apply ➜**](https://www.tesla.com/careers/search/job/284776) |
| DoorDash | Machine Learning Engineer Intern - Masters | Seattle, WA; SF; NYC; Sunnyvale, CA | Summer 2027 | 100% | 2026-09-25 | 2026-09-26 | [**Apply ➜**](https://job-boards.greenhouse.io/doordashusa/jobs/8204111) |
| Metropolitan Transportation Authority | Software Analyst / Developer Intern - Fall | NYC | Fall 2026 | 100% | 2026-09-25 | 2026-09-26 | [**Apply ➜**](https://jobs.jobvite.com/metropolitantransportationauthority/job/o6WRAfwd?nl=1&nl=1&fr=false) |
| Metropolitan Transportation Authority | Software Analyst / Developer Intern | NYC | Fall 2026 | 100% | 2026-09-25 | 2026-09-26 | [**Apply ➜**](https://jobs.jobvite.com/metropolitantransportationauthority/job/o4WRAfwb?nl=1&nl=1&fr=false) |
| Rockwell Automation | AI Software Engineering Co-op - 6 months - 8 months | Mayfield Heights, OH; Milwaukee, WI | Winter 2027 | 100% | 2026-09-25 | 2026-09-26 | [**Apply ➜**](https://rockwellautomation.wd1.myworkdayjobs.com/External-Rockwell-Automation-Early-Careers/job/Mayfield-Heights-Ohio-United-States/Co-op--AI-Software-Engineering--6-8-months-_R26-6982) |
| Rockwell Automation | AI Software Engineering Co-op - 6 months - 8 months | Mayfield Heights, OH; Milwaukee, WI | Winter 2027 | 100% | 2026-09-25 | 2026-09-26 | [**Apply ➜**](https://rockwellautomation.wd1.myworkdayjobs.com/External_Rockwell_Automation/job/Mayfield-Heights-Ohio-United-States/Co-op--AI-Software-Engineering--6-8-months-_R26-6982-1) |
| Amazon | Software Development Engineer Intern - Summer 2027 - USA - Amazon Dedicated Cloud - ADC | Seattle, WA | Summer 2027 | 100% | 2026-09-25 | 2026-09-25 | [**Apply ➜**](https://www.amazon.jobs/jobs/10559746/apply) |
| Amazon | Software Development Engineer Intern - Amazon Leo - Summer 2027 - USA | Redmond, WA | Summer 2027 | 100% | 2026-09-19 | 2026-09-25 | [**Apply ➜**](https://www.amazon.jobs/jobs/10559762/apply) |
| Ciena | WaveLogic Software Intern Spring 2027 | Atlanta, GA | Spring 2027 | 100% | 2026-09-24 | 2026-09-25 | [**Apply ➜**](https://ciena.wd5.myworkdayjobs.com/en-US/careers/job/Atlanta/WaveLogic-Software-Intern-Spring-2027_R031692) |
| Greenheck Group | Application Developer Co-op | Schofield, WI | Winter 2027 | 100% | 2026-09-25 | 2026-09-25 | [**Apply ➜**](https://greenheckgroup.wd5.myworkdayjobs.com/external/job/Schofield-WI/Application-Developer-Co-op_JR104721) |
| Snowflake | Software Engineer Intern - Core - Infrastructure & Security — Spring 2027 | Menlo Park, CA +1 | Spring 2027 | 100% | 2026-09-25 | 2026-09-25 | [**Apply ➜**](https://jobs.ashbyhq.com/snowflake/5315b6f6-2c14-4cb9-a884-c2bae69f2c69) |
| Snowflake | Software Engineer Intern - Database Engineering - Spring 2027 | Menlo Park, CA +1 | Spring 2027 | 100% | 2026-09-25 | 2026-09-25 | [**Apply ➜**](https://jobs.ashbyhq.com/snowflake/7bd393df-67d7-4009-ba4f-1cd79a82b0be) |
| Snowflake | Software Engineer Intern - AI / ML - Spring 2027 | Menlo Park, CA +1 | Spring 2027 | 100% | 2026-09-25 | 2026-09-25 | [**Apply ➜**](https://jobs.ashbyhq.com/snowflake/4be290ae-dd9d-488c-9d90-56fcd69101ca) |
| Amazon | Software Development Engineer Intern - Summer 2027 (USA) , Amazon Dedicated Cloud (ADC) | Seattle, Washington, USA | Summer 2027 | 100% | 2026-09-24 | 2026-09-25 | [**Apply ➜**](https://www.amazon.jobs/en/jobs/10559746/software-development-engineer-intern-summer-2027-usa-amazon-dedicated-cloud-adc) |
| Amazon | Software Development Engineer Intern, Amazon Leo - Summer 2027 (USA) | Redmond, Washington, USA | Summer 2027 | 100% | 2026-09-24 | 2026-09-25 | [**Apply ➜**](https://www.amazon.jobs/en/jobs/10559762/software-development-engineer-intern-amazon-leo-summer-2027-usa) |
| Astranis Space Technologies | Software Developer - Network Software Intern - Winter 2027 | San Francisco, CA | Winter 2027 | 100% | 2026-09-24 | 2026-09-25 | [**Apply ➜**](https://job-boards.greenhouse.io/astranis/jobs/4705599006) |
| Radiance Technologies | Software Engineer Intern | Dayton, OH | Spring 2027 | 100% | 2026-09-24 | 2026-09-25 | [**Apply ➜**](https://radiancetech.wd12.myworkdayjobs.com/Radiance_External/job/Dayton-Office/Software-Engineer-Intern-Spring-Summer-2027_HR102442) |
| Radiance Technologies | Software Engineer Intern | Dayton, OH | Spring 2027 | 100% | 2026-09-24 | 2026-09-25 | [**Apply ➜**](https://radiancetech.wd12.myworkdayjobs.com/Radiance_External/job/Dayton-Office/Software-Engineer-Intern-Spring-Summer-2027_HR102445) |
| Radiance Technologies | Software Engineer Intern | Dayton, OH | Spring 2027 | 100% | 2026-09-24 | 2026-09-25 | [**Apply ➜**](https://radiancetech.wd12.myworkdayjobs.com/Radiance_External/job/Dayton-Office/Software-Engineer-Intern-Spring-Summer-2027_HR102446) |
| Radiance Technologies | Software Engineer Intern | Dayton, OH | Spring 2027 | 100% | 2026-09-24 | 2026-09-25 | [**Apply ➜**](https://radiancetech.wd12.myworkdayjobs.com/Radiance_External/job/Dayton-Office/Software-Engineer-Intern-Spring-Summer-2027_HR102443) |
<!-- JOB-BOARD:END -->
