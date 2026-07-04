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

### GitHub Actions (optional)

[`.github/workflows/scrape.yml`](.github/workflows/scrape.yml) can run the
scraper in CI and upload `discovered-jobs.json` as an artifact. It is
**manual-trigger only by default**; uncomment the `schedule` block to run it
daily. It uses a throwaway database in the runner — your local data and
credentials are never involved.

## Tests & verification

```bash
npm test           # 24 unit tests
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
