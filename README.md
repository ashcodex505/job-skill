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
and an identifying User-Agent. No CAPTCHA/auth bypassing, no HTML scraping.
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

![open roles](https://img.shields.io/badge/open%20roles-429-blue) ![new this cycle](https://img.shields.io/badge/new%20this%20cycle-3-brightgreen) ![updated](https://img.shields.io/badge/updated-2026--08--17-informational)

Updated **2026-08-17 20:39 UTC** · **[Full job board ➜ JOBS.md](JOBS.md)**

| Company | Role | Location | Season | Match | Posted | First seen | Apply |
|---|---|---|---|---|---|---|---|
| Datadog | Software Engineer Intern - Observability and Security Platform 🆕 | Boston, MA; NYC | Winter 2027 | 100% | 2026-08-17 | 2026-08-17 | [**Apply ➜**](https://careers.datadoghq.com/detail/8052095/?gh_jid=8052095) |
| TikTok | Machine Learning Engineer Intern - E-Commerce Governance 🆕 | Seattle, WA | Fall 2026 | 100% | 2026-08-17 | 2026-08-17 | [**Apply ➜**](https://lifeattiktok.com/search/7674029136531015941) |
| Replit | Software Engineering Intern (Summer 2027) | Foster City, CA | Summer 2027 | 100% | 2026-08-15 | 2026-08-15 | [**Apply ➜**](https://jobs.ashbyhq.com/replit/7e0dafe8-3eec-442e-aa76-a4d84d779fb1) |
| Abridge | Software Engineer Intern | SF; NYC | Fall 2026 | 100% | 2026-08-15 | 2026-08-15 | [**Apply ➜**](https://jobs.ashbyhq.com/abridge/3f07a457-dc14-4238-bf4e-5c33b5c1f883/application?embed=true) |
| Hypercubic | Software Engineering Intern | SF | Fall 2026 | 100% | 2026-08-15 | 2026-08-15 | [**Apply ➜**](https://jobs.ashbyhq.com/hypercubic/ab7a23f9-7280-4443-b442-2813dc39d490/application?embed=true) |
| Crowe | Data Analytics Developer Intern - Consulting Practice | Chicago, IL | Fall 2026 | 100% | 2026-08-14 | 2026-08-15 | [**Apply ➜**](https://crowe.wd12.myworkdayjobs.com/en-US/external_careers/job/Chicago-IL-USA/Data-Analytics-Developer-Intern_R-71041) |
| Interdigital | Wireless Engineering Intern - 6G Wireless Systems | Manhattan, NYC; Melville, NY; Conshohocken, PA | Fall 2026 | 100% | 2026-08-14 | 2026-08-15 | [**Apply ➜**](https://interdigital.wd5.myworkdayjobs.com/InterDigital_Intern/job/Conshohocken-PA/PhD-Intern--6G-Wireless-Systems---Sept-2026_REQ26-1135) |
| Valeo | Software Engineer Intern | Troy, MI | Fall 2026 | 100% | 2026-08-14 | 2026-08-15 | [**Apply ➜**](https://valeo.wd3.myworkdayjobs.com/en-US/valeo_jobs/job/Troy-MI/Software-Engineer-Intern_REQ2026076575) |
| TransMarket Group | Software Engineer Intern | Chicago, IL | Fall 2026 | 100% | 2026-08-14 | 2026-08-14 | [**Apply ➜**](https://job-boards.greenhouse.io/transmarketgroup/jobs/5212335007?gh_jid=5212335007) |
| Applied Intuition | Software Integration Engineer - New Grad (2027) | Sunnyvale | 2027 New Grad | 100% | 2026-08-14 | 2026-08-14 | [**Apply ➜**](https://jobs.ashbyhq.com/applied/250080bd-10a8-4e5f-82b8-506029292d19) |
| Notion | Software Engineer Intern (Summer 2027) | San Francisco, California; New York, New York | Summer 2027 | 100% (4 skills) | 2026-08-14 | 2026-08-14 | [**Apply ➜**](https://jobs.ashbyhq.com/notion/3fba1c39-c5cb-47d7-9ad2-1cec4d7e9d0c) |
| Notion | Software Engineer Intern (Winter 2027) | San Francisco, California; New York, New York | Winter 2027 | 100% (4 skills) | 2026-08-14 | 2026-08-14 | [**Apply ➜**](https://jobs.ashbyhq.com/notion/e66c6658-9e65-4c58-8db2-844628b6e8f8) |
| Baker Hughes | Benefit Tool Developer Intern - Month Fixed Term Contract | Aberdeen, UK | Fall 2026 | 100% | 2026-08-14 | 2026-08-14 | [**Apply ➜**](https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes/job/GB-AC-ABERDEEN-BAKER-HUGHES-BUILDING/Intern---Benefit-Tool-Developer--12-Month-Fixed-Term-Contract-_R168066) |
| Composio | Fullstack Engineering Internship - Product Team - Fall 2026 & Winter 2027 | San Francisco, CA | Fall 2026 | 100% | 2026-08-14 | 2026-08-14 | [**Apply ➜**](https://jobs.ashbyhq.com/composio/eea3c0be-8589-4e3d-a684-de29a9eada0d) |
| MSA Safety | Software Engineer Co-op - Product Development | Cranberry Township, PA | Spring 2027 | 100% | 2026-08-14 | 2026-08-14 | [**Apply ➜**](https://careers.msasafety.com/jobs/9992?icims=1) |
| National Laboratory of the Rockies | Transportation Systems Analysis Intern - Year-Round | Golden, CO | Fall 2026 | 100% | 2026-08-13 | 2026-08-13 | [**Apply ➜**](https://nrel.wd5.myworkdayjobs.com/NLR/job/Golden-CO/Graduate--Year-Round--Intern---Transportation-Systems-Analysis_R14385) |
| Interco | Software Development Intern - React | St. Louis, MO | Fall 2026 | 100% (1 skills) | 2026-08-13 | 2026-08-13 | [**Apply ➜**](https://jobs.smartrecruiters.com/Interco/744000143346169) |
| Specter Aerospace | Front-End Software Developer Co-op | Boston, MA; Peabody, MA | Spring 2027 | 100% | 2026-08-13 | 2026-08-13 | [**Apply ➜**](https://specteraerospace.bamboohr.com/careers/120/) |
| Inbulks | Junior Front End Developer Intern | Long Island City, Queens, NY | Fall 2026 | 100% | 2026-08-13 | 2026-08-13 | [**Apply ➜**](https://jobs.smartrecruiters.com/InbulksCorp/743999750129753) |
| Schweitzer Engineering Laboratories | Software Engineer Intern - AI Focus | Pullman, WA | Fall 2026 | 100% | 2026-08-12 | 2026-08-13 | [**Apply ➜**](https://selinc.wd1.myworkdayjobs.com/SEL/job/Washington---Pullman/Software-Engineering-Intern--AI-Focus-_2026-22601) |
<!-- JOB-BOARD:END -->
