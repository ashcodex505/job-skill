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

![open roles](https://img.shields.io/badge/open%20roles-706-blue) ![new this cycle](https://img.shields.io/badge/new%20this%20cycle-2-brightgreen) ![updated](https://img.shields.io/badge/updated-2026--09--14-informational)

Updated **2026-09-14 06:53 UTC** · **[Full job board ➜ JOBS.md](JOBS.md)**

| Company | Role | Location | Season | Match | Posted | First seen | Apply |
|---|---|---|---|---|---|---|---|
| Philips | Software Systems Engineering Co-op - Image Guided Therapy Devices - IVUS Clinical Imaging Software Application 🆕 | Plymouth, MN | Winter 2027 | 100% | 2026-08-24 | 2026-09-14 | [**Apply ➜**](https://philips.wd3.myworkdayjobs.com/jobs-and-careers/job/Plymouth-Minnesota-United-States/Intern-Co-op---Software-System-Engineering---Plymouth--MN---Summer-2027_590406) |
| fourier | Fall 2026 R&D Engineering Intern – Hydrogen Systems | HQ | Fall 2026 | 100% | 2026-08-06 | 2026-09-13 | [**Apply ➜**](https://jobs.ashbyhq.com/fourier/5b8d0c16-3b74-40ff-b5e6-9fdde6db0e86) |
| Klaviyo | Software Engineer Co-op - Spring 2027 | Boston, MA | Spring 2027 | 100% | 2026-09-12 | 2026-09-12 | [**Apply ➜**](https://job-boards.greenhouse.io/klaviyocampus/jobs/7989365003) |
| Abridge | Software Engineer Intern | SF; NYC | Fall 2026 | 100% | 2026-08-15 | 2026-09-12 | [**Apply ➜**](https://jobs.ashbyhq.com/abridge/3f07a457-dc14-4238-bf4e-5c33b5c1f883/application?embed=true) |
| Commure | Software Engineer - Early Career 2027 | Mountain View, CA +1 | 2027 New Grad | 100% | 2026-09-11 | 2026-09-12 | [**Apply ➜**](https://jobs.ashbyhq.com/commure/c6a735ef-3d84-4447-94a9-9e8b2dfefced) |
| Draper | Systems Engineering Co-op - Spring 2027 | Cambridge, MA | Spring 2027 | 100% | 2026-09-11 | 2026-09-12 | [**Apply ➜**](https://draper.wd5.myworkdayjobs.com/Draper_Careers/job/Cambridge-MA/Systems-Engineering-Co-Op--Spring-2027-_JR002882) |
| AMD | Machine Learning System Engineering Intern/Co-op | San Jose, CA; Santa Clara, CA | Winter 2027 | 100% | 2026-09-11 | 2026-09-11 | [**Apply ➜**](https://careers.amd.com/jobs/92342?icims=1) |
| AMD | AI Systems & GPU Performance Engineer Intern | San Jose, CA; Santa Clara, CA | Spring 2027 | 100% | 2026-09-11 | 2026-09-11 | [**Apply ➜**](https://careers.amd.com/jobs/92354?icims=1) |
| Lyft | Software Engineer Intern, Backend (Summer 2027) | San Francisco, CA | Summer 2027 | 100% | 2026-09-11 | 2026-09-11 | [**Apply ➜**](https://app.careerpuck.com/job-board/lyft/job/8767726002?gh_jid=8767726002) |
| Lyft | Software Engineer Intern, Fullstack (Summer 2027) | New York, NY | Summer 2027 | 100% (5 skills) | 2026-09-11 | 2026-09-11 | [**Apply ➜**](https://app.careerpuck.com/job-board/lyft/job/8797837002?gh_jid=8797837002) |
| Tesla | Software Engineer Intern - Data Platforms | Palo Alto, CA | Spring 2027 | 100% | 2026-09-11 | 2026-09-11 | [**Apply ➜**](https://www.tesla.com/careers/search/job/283117) |
| TD Bank | Software Engineer Co-op - Global Technology & Solutions | Mt Laurel Township, NJ | Spring 2027 | 100% | 2026-09-11 | 2026-09-11 | [**Apply ➜**](https://td.wd3.myworkdayjobs.com/TD_Bank_Careers/job/Mount-Laurel-New-Jersey/XMLNAME-2027-Spring-Co-op---Global-Technology---Solutions---Software-Engineer--SWE-_R_1509773) |
| GrayMatter Robotics | Robotics Engineering Intern - Systems & Applications | LA; Carson, CA | Fall 2026 | 100% | 2026-09-11 | 2026-09-11 | [**Apply ➜**](https://jobs.ashbyhq.com/graymatter-robotics/aa7c2419-7bb9-4080-9403-937c4db01bb6/application?embed=true) |
| Paccar | Software Developer Intern | Renton, WA | Winter 2027 | 100% | 2026-09-10 | 2026-09-10 | [**Apply ➜**](https://jobs.paccar.com/job/Renton-2027-Winter-Internship-Software-Developer-Intern-WA-98057/1435928733/?ats=successfactors) |
| RTX | Software Engineering Co-op | Cedar Rapids, IA | Spring 2027 | 100% | 2026-09-10 | 2026-09-10 | [**Apply ➜**](https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway/job/US-IA-CEDAR-RAPIDS-182--1100-Cimmie-Ave-Ne--BLDG-182/Software-Engineering-Co-op--Spring-Summer-2027-_01871551) |
| Rocket Lab | Flight Software Intern Spring 2027 | Littleton, CO | Spring 2027 | 100% | 2026-09-10 | 2026-09-10 | [**Apply ➜**](https://job-boards.greenhouse.io/rocketlab/jobs/7989724003) |
| Blue Origin | Electrical Systems Engineer Co-op - Fixed Term | LA | Winter 2027 | 100% | 2026-09-08 | 2026-09-10 | [**Apply ➜**](https://blueorigin.wd5.myworkdayjobs.com/blueorigin/job/Los-Angeles-CA/Electronics-Electrical-Systems-Engineer-Co-Op_R71548) |
| Hermeus | Software Engineer Intern - Modeling & Simulation - Multiple Teams | LA | Spring 2027 | 100% | 2026-09-01 | 2026-09-10 | [**Apply ➜**](https://jobs.lever.co/hermeus/445db430-6f81-41cf-847a-56a947afb936/apply) |
| Epic Games | Backend Services Programmer Intern - Epic Games Services | Cary, NC | Summer 2027 | 100% | 2026-09-10 | 2026-09-10 | [**Apply ➜**](https://epicgames.com/careers/jobs/6183293004?gh_jid=6183293004) |
| Nova-Tech | Software Development Co-op | Willmar, MN | Winter 2027 | 100% | 2026-09-09 | 2026-09-10 | [**Apply ➜**](https://novatechengineering.applytojob.com/apply/prjzDfwzEE/Software-Development-CoOp-Located-Onsite-In-Willmar-MN) |
<!-- JOB-BOARD:END -->
