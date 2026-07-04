# Architecture

Resume Tracker is a **local-first** personal app: one Next.js server on your Mac
serves both the UI and the API, backed by a local SQLite file. Nothing requires
the network except the job scraper (which calls public ATS APIs) and the
optional Supabase resume storage.

## Stack decisions

| Choice | Why |
| --- | --- |
| **Next.js 16 (App Router), TypeScript strict** | One process serves UI + API route handlers; trivial to wrap as a Mac app; server-only code (crypto, SQLite) stays out of the client bundle. |
| **SQLite via `@libsql/client` + Drizzle ORM** | Real relational DB with migrations (`drizzle-kit`). libsql is a prebuilt NAPI binding — no node-gyp/Xcode compile step on any Node version, unlike `better-sqlite3`. |
| **Tailwind CSS v4, hand-rolled primitives** | Dense productivity-app UI without a component-library dependency; `src/components/ui.tsx` is ~200 lines and fully ours. |
| **AES-256-GCM + macOS Keychain** | See `docs/security.md`. Keychain gives zero-password UX on macOS; scrypt master-password mode is the portable fallback. |
| **TypeScript scraper (not Python)** | The scraper shares the Drizzle schema, dedupe keys, and DB client with the app — one language, one lockfile, no venv. Python would duplicate the schema and normalization logic for no gain. |
| **Shell-script `.app` bundle (not Tauri/Electron)** | No Rust toolchain on this machine (Tauri needs one) and Electron ships a second Chromium for what is a localhost web app. A native `.app` launcher (`scripts/build-mac-app.sh`) starts the server and opens the browser — same Spotlight experience, ~5 KB. Tauri remains a clean future upgrade path. |
| **Storage abstraction for resumes** | `src/lib/storage` — `local` driver (default, `data/resumes/`) and `supabase` driver (REST, free tier). Chosen per env var; the schema records which driver stored each file. |

## Module map

```
src/
  db/            schema.ts (8 tables), index.ts (client), migrate.ts, seed.ts
  lib/
    security/    encryption.ts (pure crypto) · keychain.ts (security CLI)
                 credentials.ts (key mgmt, vault, field encryption)
    storage/     index.ts (driver interface) · local.ts · supabase.ts
    types.ts     status/job-type enums shared client+server
    status.ts    transition + pipeline logic (tested)
    validation.ts  zod schemas for every write endpoint
    api.ts       route-handler wrapper w/ typed error mapping
  scraper/       registry.ts (40+ companies → ATS) · adapters.ts (greenhouse,
                 lever, ashby, workday) · classify.ts · normalize.ts · run.ts · cli.ts
  app/
    api/         REST route handlers (applications, credentials+reveal,
                 resumes+file, jobs+save, scrape, dashboard, vault)
    (pages)      / (dashboard) · /applications · /discovery · /resumes · /settings
  components/    ui.tsx primitives · sidebar · status badges ·
                 applications/ (form, drawer, credential panel)
scripts/         build-mac-app.sh
drizzle/         generated SQL migrations
```

## Data model

- `applications` — the tracker rows; tags as a JSON array column (single-user
  app; a join table adds friction for no query we need).
- `status_events` — append-only timeline; every status change goes through
  `POST /api/applications/:id/status`, which writes the event and the row in
  one request. Cascade-deleted with the application.
- `credentials` — one per application; **no plaintext password column** (see
  security doc). Cascade-deleted.
- `resumes` — metadata + storage pointer (`storageKey`, `storageDriver`).
  Deletion is blocked while an application links to the resume.
- `discovered_jobs` — normalized scraper output, unique on `dedupe_key`
  (`source:providerId`, falling back to a URL hash). `first_seen_at` /
  `last_seen_at` / `active` track lifecycle; `saved_application_id` links to
  the tracker.
- `companies`, `scraper_runs`, `app_settings` — registry, run audit log
  (incl. per-company errors), and a small K/V store (encryption verifier).

## Scraper design (informed by career-ops and jobscanner)

Both reference projects converge on the same insight: **don't scrape career
pages — call the ATS APIs behind them.** Greenhouse, Lever, and Ashby publish
documented public JSON APIs per board slug; Workday career sites expose a JSON
endpoint. The registry maps each company to its ATS + slug; adapters are
~30 lines each. Big-tech custom portals (Google, Apple, Meta…) are listed as
`unsupported` with deep links to their early-career pages rather than fighting
anti-bot systems — we never bypass CAPTCHAs or robots rules.

Title classification (keywords, senior-exclusion, season extraction, 0–100
relevance score) is ported from the user's career-ops `portals.yml` filter
config and unit-tested. A failing company (wrong slug, API change) records an
error in `scraper_runs` and never aborts the run.
