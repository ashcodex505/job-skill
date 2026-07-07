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
table to the Actions page, and upserts a pinned **"🆕 New job matches"**
issue (label `job-alert`) whenever a cycle finds new roles — watch the repo
to get those as notifications.

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

Run policy: with an **empty watchlist the hourly scan no-ops** (a ~10s guard
job checks and skips the scrape). Adding your first watch pushes the file,
which **triggers an immediate run**, and the hourly schedule covers it from
then on. GitHub cron is best-effort, so "hourly" can occasionally drift.

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

![open roles](https://img.shields.io/badge/open%20roles-2131-blue) ![new this cycle](https://img.shields.io/badge/new%20this%20cycle-42-brightgreen) ![updated](https://img.shields.io/badge/updated-2026--07--07-informational)

Updated **2026-07-07 19:19 UTC** · **[Full job board ➜ JOBS.md](JOBS.md)**

| Company | Role | Location | Season | Match | Posted | First seen | Apply |
|---|---|---|---|---|---|---|---|
| NVIDIA | Performance Engineer Intern, Systems Software- Fall 2026 | US, MO, St. Louis | Fall 2026 | 100% | — | 2026-07-06 | [**Apply ➜**](https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-MO-St-Louis/Performance-Engineer-Intern--Systems-Software---Fall-2026_JR2015779) |
| Anduril | 2027 Early Career Software Engineer | Atlanta, Georgia, United States; Boston, Massachusetts, United States; Costa Mesa, California, United States; Irvine, California, United States; Reston, Virginia, United States; Seattle, Washington, United States | 2027 New Grad | 100% (4 skills) | 2026-07-06 | 2026-07-05 | [**Apply ➜**](https://boards.greenhouse.io/andurilindustries/jobs/5162263007?gh_jid=5162263007) |
| MongoDB | Software Engineering Internship - Summer 2026/2027 | Sydney | Summer 2026 | 100% (7 skills) | 2026-07-06 | 2026-07-05 | [**Apply ➜**](https://www.mongodb.com/careers/job/?gh_jid=7768470) |
| Notion | Software Engineer Intern (Fall 2026) | San Francisco, California | Fall 2026 | 100% (4 skills) | 2026-04-06 | 2026-07-05 | [**Apply ➜**](https://jobs.ashbyhq.com/notion/5b15697c-fa91-4511-9482-c98a6ff29f90) |
| NVIDIA | Software Engineering Intern, JAX - Fall 2026 | US, CA, Santa Clara | Fall 2026 | 100% | — | 2026-07-05 | [**Apply ➜**](https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Software-Engineering-Intern--JAX---Fall-2026_JR2009745) |
| NVIDIA | PhD Software Engineering Intern, Decision Intelligence - Fall 2026 | US, CA, Santa Clara | Fall 2026 | 100% | — | 2026-07-05 | [**Apply ➜**](https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/PhD-Software-Engineering-Intern--Decision-Intelligence---Fall-2026_JR2017522) |
| NVIDIA | PhD Research Intern, System Software and I/O Architecture - Fall 2026 | 3 Locations | Fall 2026 | 100% | — | 2026-07-05 | [**Apply ➜**](https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/PhD-Research-Intern--System-Software-and-I-O-Architecture---Fall-2026_JR2019667) |
| SpaceX | Fall 2026 Software Engineering Internship/Co-op | Flexible - Any SpaceX Site | Fall 2026 | 100% (4 skills) | 2026-06-29 | 2026-07-05 | [**Apply ➜**](https://boards.greenhouse.io/spacex/jobs/8403219002?gh_jid=8403219002) |
| Anduril | 2026 Early Career Software Engineer | Atlanta, Georgia, United States; Costa Mesa, California, United States; Fort Collins, Colorado, United States; Seattle, Washington, United States | 2026 New Grad | 96% (4 skills) | 2026-07-06 | 2026-07-05 | [**Apply ➜**](https://boards.greenhouse.io/andurilindustries/jobs/4802146007?gh_jid=4802146007) |
| Roblox | [2026] Senior Machine Learning Engineer, Recommendation Systems - PhD Early Career | San Mateo, CA, United States | 2026 New Grad | 95% (3 skills) | 2026-07-06 | 2026-07-05 | [**Apply ➜**](https://careers.roblox.com/jobs/7350081?gh_jid=7350081) |
| Roblox | [2026] Senior Machine Learning Engineer, Account Identity - PhD Early Career | San Mateo, CA, United States | 2026 New Grad | 93% (2 skills) | 2026-07-07 | 2026-07-05 | [**Apply ➜**](https://careers.roblox.com/jobs/7473686?gh_jid=7473686) |
| Roblox | [2026] Senior Machine Learning Engineer, Engine Optimization - PhD Early Career | San Mateo, CA, United States | 2026 New Grad | 93% (2 skills) | 2026-07-07 | 2026-07-05 | [**Apply ➜**](https://careers.roblox.com/jobs/7421746?gh_jid=7421746) |
| Roblox | [2026] Senior Machine Learning Engineer (Systems), Embodied AI/NPCs, ML Platform - PhD Early Career | San Mateo, CA, United States | 2026 New Grad | 92% (1 skills) | 2026-07-06 | 2026-07-05 | [**Apply ➜**](https://careers.roblox.com/jobs/8027587?gh_jid=8027587) |
| Roblox | [2026] Senior Machine Learning Engineer (Systems), Embodied AI/NPCs, ML Platform - PhD Early Career | San Mateo, CA, United States | 2026 New Grad | 92% (1 skills) | 2026-07-06 | 2026-07-05 | [**Apply ➜**](https://careers.roblox.com/jobs/8027588?gh_jid=8027588) |
| Adobe | 2026 University Graduate - Machine Learning Engineer | Seattle | 2026 New Grad | 90% | — | 2026-07-05 | [**Apply ➜**](https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced/job/Seattle/XMLNAME-2026-University-Graduate---Machine-Learning-Engineer_R160133) |
| NVIDIA | System Software Engineering Intern, Systems Infrastructure - Summer 2026 | China, Shanghai | Summer 2026 | 90% | — | 2026-07-05 | [**Apply ➜**](https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/China-Shanghai/System-Software-Engineer-Intern--Systems-Infrastructure--Summer-2026_JR2006824) |
| NVIDIA | Software Engineering Intern, Neural Reconstruction - Summer 2026 | China, Shanghai | Summer 2026 | 90% | — | 2026-07-05 | [**Apply ➜**](https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/China-Shanghai/Software-Engineering-Intern--Neural-Reconstruction---Summer-2026_JR2010555-1) |
| Notion | Software Engineer, Early Career | San Francisco, California | — | 88% (5 skills) | 2026-07-06 | 2026-07-06 | [**Apply ➜**](https://jobs.ashbyhq.com/notion/297b4ece-765f-4eea-b1b8-46057cb6501f) |
| Notion | Software Engineer, Early Career (AI) | San Francisco, California | — | 88% (5 skills) | 2026-07-06 | 2026-07-06 | [**Apply ➜**](https://jobs.ashbyhq.com/notion/85947779-6b87-466a-98bc-30a640448c28) |
| Instacart | Machine Learning Engineer, PhD Intern (Fall) | United States - Remote | — | 88% (2 skills) | 2026-06-24 | 2026-07-05 | [**Apply ➜**](https://instacart.careers/job/?gh_jid=5917202) |
<!-- JOB-BOARD:END -->
