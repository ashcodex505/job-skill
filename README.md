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
  25+ companies (Stripe, OpenAI, Anthropic, NVIDIA, Palantir, Databricks, …)
  via official Greenhouse/Lever/Ashby/Workday APIs, scores them for a
  Summer-2027-intern / 2027-new-grad search, and one click saves a role into
  the tracker.
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
| `npm run board` | scrape + regenerate JOBS.md and the README job board |
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
  match adds up to +25 to the job's score, and the matched skills show up in
  the Discovery score tooltip (e.g. `76 (4✓)`).
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

Updated **2026-07-04 20:13 UTC** · 221 open roles tracked · **[Full job board ➜ JOBS.md](JOBS.md)**

| Company | Role | Location | Season | Match | First seen | Apply |
|---|---|---|---|---|---|---|
| Stripe | Software Engineer, Intern 🆕 | Sydney, Australia | — | 73 (2✓) | 2026-07-04 | [**Apply ➜**](https://stripe.com/jobs/search?gh_jid=7532256) |
| Stripe | Software Engineer, New Grad, Developer & End User Experience Platform 🆕 | Toronto | — | 73 (2✓) | 2026-07-04 | [**Apply ➜**](https://stripe.com/jobs/search?gh_jid=7991718) |
| Stripe | Global Sales Enablement Systems Administrator 🆕 | US-Remote | — | 53 (5✓) | 2026-07-04 | [**Apply ➜**](https://stripe.com/jobs/search?gh_jid=7993682) |
| Stripe | Fullstack Engineer, Privy 🆕 | NYC-Privy, US-Remote | — | 51 (4✓) | 2026-07-04 | [**Apply ➜**](https://stripe.com/jobs/search?gh_jid=7091959) |
| OpenAI | Software Engineer, Full Stack (People Innovation) 🆕 | Remote - US; San Francisco | — | 50 (3✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/d4780eac-03ad-4dae-861f-99af22b4287e) |
| Stripe | Backend Engineer, Core Tech, Canada 🆕 | Toronto, CAN-Remote | — | 50 (3✓) | 2026-07-04 | [**Apply ➜**](https://stripe.com/jobs/search?gh_jid=6567253) |
| Stripe | Backend Engineer, Core Technology 🆕 | US-Remote, Chicago, Seattle, San Francisco | — | 50 (3✓) | 2026-07-04 | [**Apply ➜**](https://stripe.com/jobs/search?gh_jid=6042172) |
| OpenAI | Full-Stack SWE, Data Acquisition (Foundations) 🆕 | San Francisco | — | 49 (6✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/a886ff48-b8a1-4e28-b468-296713a5ad78) |
| OpenAI | Software Engineer, Identity Infrastructure Engineering 🆕 | San Francisco; New York City; Seattle; Remote - US | — | 48 (2✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/551b0d0d-46c2-42fb-bb05-46e2fba8d4db) |
| OpenAI | Manufacturing Test Engineer, AI Compute Infrastructure - Stargate 🆕 | Remote - US | — | 48 (2✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/8a950265-0527-48f8-be3c-2923d7d96940) |
| OpenAI | Software Engineer, Infrastructure Security 🆕 | Remote - US; New York City; Seattle; San Francisco | — | 48 (2✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/98ad9beb-4f91-496c-bd16-ac0b2a8d5bb2) |
| Stripe | Full Stack Engineer, Link 🆕 | Toronto, Remote in Canada | — | 48 (2✓) | 2026-07-04 | [**Apply ➜**](https://stripe.com/jobs/search?gh_jid=6447175) |
| Stripe | Software Engineer 🆕 | New York, NY | — | 48 (5✓) | 2026-07-04 | [**Apply ➜**](https://stripe.com/jobs/search?gh_jid=8009143) |
| OpenAI | Software Engineer, Security Observability 🆕 | San Francisco; New York City; Seattle; Remote - US | — | 47 (1✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/1e4e9985-babf-4bd9-8fe8-a2016250780d) |
| OpenAI | Security Engineer, Infrastructure Security 🆕 | Remote - US; New York City; Seattle; San Francisco | — | 47 (1✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/f51f750f-a737-4441-8f96-30133a2a8049) |
| Stripe | Software Engineer, Security Analytics Infrastructure 🆕 | US - Remote | — | 47 (1✓) | 2026-07-04 | [**Apply ➜**](https://stripe.com/jobs/search?gh_jid=7826761) |
| OpenAI | Capacity Systems Software Engineer 🆕 | San Francisco | — | 46 (4✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/11c51b12-3ba0-4a7a-a0d2-ed0661324dc3) |
| OpenAI | Full-Stack Software Engineer, Compute Foundations 🆕 | San Francisco | — | 46 (4✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/1312f55e-ff56-4dab-9bf7-a91e2c157572) |
| OpenAI | Full Stack Software Engineer, ChatGPT Finances 🆕 | San Francisco | — | 46 (4✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/39e06ef9-5e62-425d-81e2-e8690188011f) |
| OpenAI | Full Stack Engineer, Fleet Scheduling 🆕 | San Francisco | — | 46 (4✓) | 2026-07-04 | [**Apply ➜**](https://jobs.ashbyhq.com/openai/9d11e1d8-af1d-413b-873f-d8fac2bdee99) |
<!-- JOB-BOARD:END -->
