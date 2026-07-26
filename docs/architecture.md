# Architecture

Resume Tracker is a **local-first system with a cloud shadow**. Your Mac runs
the full app (UI + API + SQLite + scraper); GitHub Actions runs a stateless
copy of just the scraper on schedules and publishes results as markdown and
issues. The two halves share state through **committed files**
(`board/jobs.json`, `career/*.md`) — the core trick that gives stateless CI
runners memory.

```
┌─ YOUR MAC ──────────────────────────────┐      ┌─ GITHUB ────────────────────────┐
│ Resume Tracker.app (launcher)           │      │ job-board.yml   (every 12h)     │
│   └─ Next.js server :3141               │      │ watch.yml       (hourly)        │
│        ├─ React UI (5 pages)            │ push │ registry-check  (monthly)       │
│        ├─ API route handlers            │─────▶│   └─ npm run board              │
│        ├─ SQLite (data/, git-ignored)   │◀─────│        ├─ JOBS.md + README      │
│        ├─ macOS Keychain (crypto key)   │ pull │        ├─ board/jobs.json       │
│        └─ scraper (same code CI runs)   │      │        └─ issues → 📱 phone     │
└─────────────────────────────────────────┘      └─────────────────────────────────┘
```

## Technology stack and why each piece

| Tech | Where | Why |
| --- | --- | --- |
| **Next.js 16** (App Router) | `src/app/` | One process serves UI + API; server-only code (crypto, SQLite) never reaches the browser bundle |
| **TypeScript strict** | everywhere | The whole pipeline — scraper → DB → API → UI — shares one type system (`RawJob` → `NormalizedJob` → `BoardJob` / `DiscoveredJob`) |
| **SQLite via `@libsql/client`** | `src/db/index.ts` | Real relational DB, zero server; libsql is NAPI-prebuilt so no node-gyp compile step on any Node version |
| **Drizzle ORM + drizzle-kit** | `src/db/schema.ts`, `drizzle/` | Typed queries + generated, replayable SQL migrations |
| **Zod** | `src/lib/validation.ts` + routes | Every write endpoint validates input. Gotcha handled in the PATCH routes: `.partial()` re-injects `.default()`s, so handlers apply only keys the client actually sent |
| **Tailwind v4 + hand-rolled primitives** | `src/components/ui.tsx` | ~250 owned lines (Button/Modal/Drawer/Badge/TagInput) instead of a component-library dependency |
| **Node `crypto`** | `src/lib/security/encryption.ts` | AES-256-GCM + scrypt with no third-party crypto deps |
| **`security` CLI (macOS)** | `src/lib/security/keychain.ts` | Keychain access without native modules — spawned via `execFile`, never a shell |
| **GitHub Actions + `gh`** | `.github/workflows/` | Scheduling, publishing, and phone notifications with zero servers |
| **Claude Code CLI** | `src/lib/claude.ts` | Optional natural-language layer (`claude -p`); every feature degrades gracefully without it |
| **Vitest** | `*.test.ts` | Tests target the pure modules exclusively — which is why purity is enforced architecturally |

## Module map

```
src/
  db/            schema.ts (8 tables) · index.ts (libsql client) · migrate.ts · seed.ts
  lib/
    security/    encryption.ts (pure AES-GCM/scrypt) · keychain.ts · credentials.ts (vault)
    storage/     index.ts (driver interface) · local.ts · supabase.ts (REST, no SDK)
    career/      markdown.ts (client-safe parser) · config.ts (profile/preferences)
                 watchlist.ts (pure parse/serialize/match)
    import/      simplify.ts (CSV parser, header synonyms, status mapping)
    types.ts · status.ts · validation.ts · api.ts (route wrapper) · client.ts · claude.ts
  scraper/
    registry.ts  companies → ATS + slug (greenhouse/lever/ashby/workday/
                 smartrecruiters/workable/amazon/unsupported)
    adapters.ts  one fetch adapter per ATS + Amazon's own search API +
                 SimplifyJobs, vanshb03, and speedyapply community feeds
    classify.ts  title regexes, dynamic season targets, score breakdown,
                 hard US/remote/hybrid location filter                  (pure)
    normalize.ts RawJob → NormalizedJob, canonical-URL dedupe + location
                 hard filter, skill boost                               (pure)
    big-tech-alert.ts  big-tech/unicorn selector (quant/banks excluded,
                 postings older than 1 week excluded even if newly
                 discovered) + committed alert ledger (board/alerted.json)
                 — no posting is ever notified twice
    board.ts     mergeBoard/diffNewJobs/closeJobs/renderers             (pure)
    run.ts       orchestration + DB upsert + source-aware deactivation
    board-cli.ts npm run board [--watch|--company|--no-linkcheck]; CI outputs
    check-cli.ts npm run scrape:check (slug doctor)
    cli.ts       npm run scrape
  app/
    api/         applications (+status/credential/reveal) · resumes (+file) · jobs
                 (+save/description) · scrape · dashboard · vault · career ·
                 watchlist · import/simplify
    (pages)      / (dashboard+watchlist) · /applications · /discovery · /resumes · /settings
  components/    ui.tsx · sidebar · status · watchlist-panel ·
                 applications/ (form, drawer, credential panel, post-apply, import)
scripts/         build-mac-app.sh (Spotlight-launchable .app)
career/          profile.md · preferences.md · watchlist.md (app-managed) — human-readable
board/jobs.json     committed scraper state (firstSeenAt memory across CI runs)
board/feed-heads.json  last-seen commit SHA per watched community repo (gate state)
board/alerted.json  every URL ever included in a ⭐/🚨 issue (180d retention)
.github/workflows/  job-board.yml (12h full sweep) · watch.yml (community-feed
                     scrape gated on upstream commits, twice-hourly poll; plus
                     an ungated Amazon-only check every run) · registry-check.yml
                     (monthly slug doctor)
```

## Data model (8 tables)

- `applications` — tracker rows; tags as a JSON-array column (single-user app,
  no join-table friction).
- `status_events` — append-only timeline; every status change goes through
  `POST /api/applications/:id/status`; cascade-deleted (FK enforcement is on
  by default in libsql).
- `credentials` — one per application; **no plaintext password column**:
  ciphertext, IV, per-record salt, `encryption_version` only.
- `resumes` — metadata + storage pointer (`storageKey`, `storageDriver`);
  deletion blocked while linked to an application.
- `discovered_jobs` — normalized scraper output; unique `dedupe_key`;
  `score` + `score_breakdown` (JSON); `description` (stripped, 10k cap);
  `posted_at` vs `first_seen_at` vs `last_seen_at`; `active` lifecycle;
  `saved_application_id` link (cleared on application delete).
- `companies`, `scraper_runs` (audit log incl. per-company errors),
  `app_settings` (K/V; holds the encryption verifier).

## The scraping engine

**Registry → adapters.** The insight (from jobscanner/career-ops): *don't
scrape career pages — call the JSON APIs behind them.* Each adapter is ~30
lines mapping an official public API to `RawJob[]`: Greenhouse
(`boards-api…?content=true` for descriptions), Lever, Ashby, Workday
(paginated POST to the career site's own endpoint), SmartRecruiters
(paginated), Workable. All share one polite fetch: 20s timeout, identifying
User-Agent, sleeps between pages; a failing company records an error in
`scraper_runs` and never aborts the run.

**Amazon.** Unlike the other "custom portal" giants, `amazon.jobs/en/search.json`
is a public, unauthenticated endpoint the careers site's own search box calls
— same trust tier as the other adapters, just not slug-based. `scrapeAmazon`
loops a small set of intern/new-grad query terms (Amazon's own
`is_intern`/`university_job` flags are unreliable on this public endpoint) and
leaves relevance filtering to `classifyTitle` as usual.

**Community feeds.** Google/Meta/Apple/Microsoft/Netflix/Tesla still sit
behind anti-bot portals we refuse to fight (`ats: "unsupported"`) or SPAs with
no server-rendered data and no discoverable public API (confirmed for Google:
no JSON-LD, no API, fully client-hydrated). Coverage for those comes from
three MIT-licensed sources: the `listings.json` published by the SimplifyJobs
GitHub repos (candidate repo/branch fallback survives season rollovers,
filtered to active + visible + posted ≤ 90 days — carries **true posted
dates**); the identically-shaped `listings.json` published by vanshb03's
`Summer2027-Internships` and `New-Grad-2027` repos (same tooling, independent
maintainer, also true posted dates — grouped under one `vansh` source since
both repos are the intern/new-grad halves of the same feed family); and
speedyapply's markdown-table intern/new-grad lists (day-precision dates only).
`simplify.jobs`'s own website (as opposed to its GitHub repos) was evaluated
and rejected as a source: it ships only 30 SSR'd listings client-side with no
public pagination API, and the only outbound link it exposes
(`simplify.jobs/jobs/click/*`) is explicitly disallowed by its own
`robots.txt` — the GitHub-published `listings.json` is the same underlying
data, published for reuse, with direct URLs and no such restriction.

**Classification (`classify.ts`, pure).**
- Role detection: word-boundary regex families for SWE-family titles;
  senior/staff/principal/manager/administrator exclusion unless the title is
  explicitly early-career.
- Season extraction: `(spring|summer|fall|winter)\s*'?\d{2,4}` normalization.
- `defaultSeasonTargets(date)`: derives next-summer/grad-year targets from
  the current date so nothing hardcodes a year; `career/preferences.md`
  Seasons overrides.
- Additive scoring with a preserved **breakdown**: role +40, intern/new-grad
  +30, season +10–25, location +5, preference keywords +10, capped at 100
  (35 for early-career titles without a SWE keyword; relevance threshold 30).

**Skill match (`career/config.ts`).** Skills from `career/profile.md` are
matched against title + description with word-boundary regexes ("Java" ≠
"JavaScript"; symbol-bearing skills like C++ fall back to substring). The
matched fraction adds up to +25 — career-ops' "CV match", deterministic
instead of LLM-based, so it runs offline and free.

**Dedupe (`normalize.ts`).** Two stages: (1) by `dedupeKey` — provider job id,
else SHA-1 of the URL; (2) by exact URL across sources, preferring adapter
copies over feed copies (they carry descriptions).

**Source-aware lifecycle (`run.ts` + `board.ts`).** The central invariant:
**absence of data is not evidence of closure.** Rows are deactivated/closed
only when their *owner* was successfully scanned this run — company rows by
that company's adapter, feed rows by the feed. Failed adapters and partial
`--company`/`--watch` runs carry everything else forward untouched.

## The job board (stateless CI with memory)

`board.ts` is pure; `board-cli.ts` does I/O. Committed `board/jobs.json` is
the memory: `mergeBoard` preserves each job's original `firstSeenAt` across
runs (even through close/reopen), moves vanished jobs to a 7-day **closed
list**, and renders JOBS.md (grouped tables with Apply links, 🆕 badges,
Posted vs First-seen columns, 🚨 urgent section) plus a README section
regenerated between `<!-- JOB-BOARD:START/END -->` markers with shields.io
badges. A marker-integrity check aborts before CI can commit a corrupted
README. Full runs also run a concurrent **dead-link check** (5-way, HEAD with
GET fallback; only definitive 404/410 closes a job).

## Watchlist & urgent alerts

`career/watchlist.md` is app-managed — the dashboard panel is the only
add/remove surface. Flow: `watchlist.ts` (pure parse/serialize/match —
company equality or "Any", all keywords in title) → `/api/watchlist`
(atomic temp+rename writes, then **git auto-sync**: pathspec-scoped
`[skip ci]` commit + push with rebase-and-retry, so CI always sees the latest
watches with zero manual git; the dashboard banner appears only if sync
fails) → hourly `watch.yml` scans only watched companies + the feed → new
matches render 🔴 in JOBS.md/README and file a **new GitHub issue per event**
(`urgent` label) — new issues because that is the only GitHub primitive that
reliably push-notifies. While the app is open, the dashboard panel also polls
locally every 5 minutes (GitHub cron is best-effort; the local poll is the
fastest signal).

## Security model (details in [security.md](security.md))

Three layers: `encryption.ts` (pure AES-256-GCM, random 96-bit IV per
operation, auth tag appended so wrong keys/tampering fail loudly; scrypt
N=2^15 with unique per-record salts for master-password mode) →
`keychain.ts` (random 256-bit key in the macOS login Keychain) →
`credentials.ts` (key resolution, an encrypted **verifier** in `app_settings`
that detects a wrong key *before* any write, encrypt-then-write ordering so
failures can't corrupt stored data). Reveal is POST-only; copied passwords
clear from the clipboard in ~45s; no code path logs plaintext; the scraper,
CI, and Supabase driver cannot reach the credentials table.

## Tracker, resumes, integrations

- **Applications**: table/Kanban/drawer, append-only timeline, quick status
  updates, post-apply capture (resume version + encrypted login prompted
  right after "Mark applied", with a drawer nudge if skipped).
- **Resumes**: versioned library behind `src/lib/storage/` — local disk
  default, Supabase Storage driver over plain REST; the schema records which
  driver stored each file.
- **Simplify CSV import** (`lib/import/simplify.ts`): RFC-4180 parser,
  synonym-based header mapping, Simplify-stage → pipeline-status mapping,
  URL-then-company+title matching, **forward-only** status sync — re-imports
  are idempotent and can never downgrade the pipeline.
- **Plain-English config editing** (`/api/career` + `lib/claude.ts`): your
  instruction + current files go through local `claude -p`; the response is
  parse-validated before writing so a bad completion can't brick the scraper.

## Mac app

`scripts/build-mac-app.sh` assembles a native `.app` bundle whose launcher
starts `next start` (if not already running) and opens the browser — the
Spotlight experience without Tauri (needs a Rust toolchain) or Electron
(ships a second Chromium for what is a localhost web app).

## Strategies worth internalizing

1. **Purity as a testing strategy** — everything algorithmic (classify,
   normalize, board, watchlist, encryption, import) is I/O-free and
   unit-tested; side effects live at the edges (CLIs, routes, adapters).
2. **Committed files as shared state** — `board/jobs.json` gives stateless
   runners memory; `career/*.md` keeps the app's knowledge about you
   human-readable and git-versioned.
3. **Absence ≠ closure** — a failed adapter or partial run can never falsely
   kill jobs, locally or on the board.
4. **Graceful degradation** — no Claude CLI → manual editing; no Keychain →
   master password; feed down → adapters continue; git sync fails → banner.
5. **Notifications via GitHub primitives** — new issues (not edits) because
   that's what push-notifies; labels as channels (`job-alert`, `urgent`,
   `maintenance`).
6. **Payloads sized for polling** — list endpoints ship flags
   (`hasDescription`) instead of megabytes; detail endpoints load on demand.
