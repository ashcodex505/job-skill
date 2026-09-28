# CI Job Scraper — Improvement Specification and Working Backlog

**Status:** Collaborative draft; nothing in this file is implemented merely because it is written here
**Created:** 2026-09-25
**Companion:** [As-built CI scraper specification](ci-web-scraper-system.md)

## 1. How we will use this document

This is the place to design the next version after reading how the current system works. Add rough ideas freely to the inbox. Before implementation, promote an idea into a numbered proposal and agree on its behavior, acceptance criteria, migration plan, and measurement.

Priority meanings:

- **P0:** correctness or data-loss risk;
- **P1:** materially improves trust or signal quality;
- **P2:** worthwhile reliability or usability work;
- **P3:** experiment or polish.

Proposal states: `idea`, `needs evidence`, `ready`, `in progress`, `shipped`, or `rejected`.

## 2. Idea inbox

Add new thoughts here without needing a full design:

- [ ] Your idea:
- [ ] Your idea:
- [ ] Your idea:
- [ ] Your idea:
- [ ] Your idea:

## 3. Success criteria for the next version

These are placeholders for us to decide together:

- Target precision: ___% of displayed jobs are genuinely worth reviewing.
- Target freshness: ___% of alerts arrive within ___ minutes of provider publication.
- Source-health goal: no silent source failure for longer than ___ minutes.
- Duplicate-rate goal: fewer than ___ duplicate board rows per 1,000 jobs.
- CI budget: no more than ___ GitHub Actions minutes/month.
- Board-size/freshness policy: ________________________________________.

## 4. Starter proposals

These proposals come from gaps visible in the current implementation. They are starting points, not decisions.

### IMP-001 — Introduce canonical company identities

- **Priority:** P1
- **State:** idea
- **Problem:** The snapshot has 717 displayed company names and visible aliases/case variants such as `Fab2`/`fab2`, `Datalab USA`/`DataLab USA`, and provider-specific legal/display names. This fragments counts, watch matching, allowlists, exclusions, and deduplication.
- **Proposed direction:** Add a stable `companyId` and alias table. Normalize every adapter/feed company before policy and alert evaluation while retaining the original display name for audit.
- **Acceptance criteria:**
  - Known aliases resolve deterministically to one company ID.
  - Watches, approved-company checks, big-tech rules, and group counts use the ID.
  - Unknown companies remain usable and are surfaced for alias review.
  - Existing `firstSeenAt` and alert history survive migration.
- **Open questions:** Should aliases live in TypeScript, JSON, or an app-managed file? How are mergers and acquired brands represented?

### IMP-002 — Define and enforce a board freshness policy

- **Priority:** P1
- **State:** idea
- **Problem:** The optional maximum posting age is disabled. Some providers expose years-old but still-live postings, while community feeds apply their own recency behavior. A live URL is not necessarily an actionable opening.
- **Proposed direction:** Decide one explicit policy, possibly source-aware: provider posted age, first-seen age fallback, and exemptions for missing dates.
- **Acceptance criteria:**
  - The policy is documented in `career/preferences.md` and this spec.
  - Old jobs are reported before removal so the impact can be reviewed.
  - Jobs with unknown dates have a deliberate rule rather than accidental permanence.
  - Alerts and board inclusion use clearly separate freshness windows.
- **Open questions:** Is 30, 45, 60, or 90 days appropriate? Should new-grad and internship windows differ?

### IMP-003 — Improve season confidence and unknown-season handling

- **Priority:** P1
- **State:** idea
- **Problem:** 959 of 1,839 active jobs have no detected season. `Internship seasons: Any` intentionally allows them, but the board does not communicate whether “unknown” means rolling, absent data, or parser uncertainty.
- **Proposed direction:** Store `seasonSource` (`title`, `feed`, `description`, `manual`, `unknown`) and a confidence value. Consider description-based detection where descriptions exist.
- **Acceptance criteria:**
  - A user can see why a season was assigned.
  - Title text remains authoritative over weaker hints.
  - Graduation windows cannot be misread as recruiting seasons.
  - Unknown season can be filtered without silently deleting it.

### IMP-004 — Add board data quality reporting

- **Priority:** P1
- **State:** idea
- **Problem:** Source failures are reported, but drift in duplicates, missing dates, missing locations, unknown seasons, alias proliferation, or anomalous volume is not summarized.
- **Proposed direction:** Generate a machine-readable quality report and a compact Actions summary on every full run. Compare it with the previous run and alert only on meaningful regressions.
- **Suggested metrics:** jobs by source, acceptance rate, rejection reason, duplicate collapse count, unknown date/location/season rate, oldest posting, company alias candidates, and per-source volume deltas.
- **Acceptance criteria:** Thresholds are tested and do not create an issue on ordinary fluctuation.

### IMP-005 — Make board state writes transactional and schema-versioned

- **Priority:** P2
- **State:** idea
- **Problem:** Several committed files are rewritten during one CLI run. They have no explicit schema version, and interruption between writes can leave mixed generations locally.
- **Proposed direction:** Validate state with Zod, add `schemaVersion` and `runId`, write temporary files, then atomically rename. Render Markdown from the validated in-memory state.
- **Acceptance criteria:**
  - Old supported state migrates explicitly.
  - Invalid/truncated state fails safely without overwriting the last good board.
  - `jobs.json`, rendered Markdown, alert payload, and summaries share a run ID.

### IMP-006 — Resolve the human board truncation contract

- **Priority:** P2
- **State:** idea
- **Problem:** `board/jobs.json` contains every job, but `JOBS.md` caps each long category at 400. Readers may assume the Markdown board is exhaustive.
- **Possible options:**
  1. Generate paginated Markdown files by role/source/company.
  2. Keep the cap but add explicit links to downloadable JSON and filtered views.
  3. Generate a static searchable HTML artifact.
- **Acceptance criteria:** A reader can discover and search all active roles without opening raw JSON, and the README remains small.

### IMP-007 — Strengthen end-to-end CI testing

- **Priority:** P2
- **State:** idea
- **Problem:** Pure transformation logic has good unit coverage, but workflow wiring, output files, alert acknowledgment ordering, and multi-run state transitions are mostly validated indirectly.
- **Proposed direction:** Add fixture-backed integration runs for full, partial, watch, failed-source, close/reopen, and alert-retry scenarios. Validate workflow YAML statically.
- **Acceptance criteria:** Tests prove the eleven invariants in the as-built spec without live network access.

### IMP-008 — Make source ownership explicit in board records

- **Priority:** P2
- **State:** idea
- **Problem:** A row stores the winning `source`, but the same job may be observed by several sources. Losing provenance is useful for dedupe diagnosis and confidence decisions.
- **Proposed direction:** Store `observations[]` or `seenBy[]` with source, source ID, URL, posted date, and last-observed time. Derive a preferred presentation identity.
- **Acceptance criteria:** Cross-source duplicates remain one role, direct data can outrank feed data field-by-field, and engineers can explain where each value came from.

### IMP-009 — Replace dropped conflict commits with retryable publication

- **Priority:** P2
- **State:** idea
- **Problem:** A genuine rebase conflict drops a completed board run and waits for the next schedule. This is safe but can delay a newly discovered role and its durable state update.
- **Proposed direction:** After a conflict, fetch current `main`, rerun the deterministic merge/render step using the already-collected scrape output, and retry once. Preserve alert idempotency.
- **Acceptance criteria:** Concurrent runs converge without manual conflict resolution or duplicate alerts.

### IMP-010 — Review alert-ledger retention semantics

- **Priority:** P2
- **State:** needs evidence
- **Problem:** Alert entries expire after 180 days. A long-lived or reintroduced canonical URL could eventually alert again. That may be desirable for a genuinely new recruiting cycle or noisy for evergreen postings.
- **Proposed direction:** Separate posting identity from notification episode and document when re-alerting is allowed.
- **Acceptance criteria:** Tests cover same URL/new requisition, closed-and-reopened, annual evergreen pages, and provider ID reuse.

### IMP-011 — Reduce community-feed concentration risk

- **Priority:** P2
- **State:** idea
- **Problem:** 1,604 of 1,839 active roles in the current snapshot come from the three community feeds. Feed changes can dominate board volume and quality.
- **Proposed direction:** Track feed agreement, validate feed schemas, retain last-known-good results on suspicious volume drops, and prioritize direct adapters for high-value companies.
- **Acceptance criteria:** A malformed or unexpectedly empty feed cannot mass-close its prior rows on the first anomalous run.

### IMP-012 — Add a controlled source onboarding checklist

- **Priority:** P3
- **State:** idea
- **Problem:** Adding a source currently depends on engineering knowledge spread across comments and docs.
- **Proposed direction:** Add a pull-request template or scripted doctor that checks stable IDs, pagination, date semantics, location behavior, description availability, retry behavior, and closure ownership.
- **Acceptance criteria:** A new adapter cannot be marked ready without tests and a completed data-quality declaration.

### IMP-013 — Unify reverse-discovery alert delivery and acknowledgment

- **Priority:** P0
- **State:** ready
- **Problem:** `discovery.yml` creates urgent and big-tech issues directly, but unlike `job-board.yml` and `watch.yml` it does not pass an alert-payload file, search existing issues by fingerprint, or run `alert:ack`. A successful discovery alert is therefore not added to the shared ledger, and a retry can duplicate it.
- **Proposed direction:** Use the same fingerprint lookup, assignment, payload, and post-success acknowledgment sequence in every workflow. Prefer a shared script or reusable workflow so the implementations cannot drift again.
- **Acceptance criteria:**
  - Discovery passes `BOARD_ALERT_PAYLOAD_FILE` to the board command.
  - An existing fingerprint prevents a duplicate issue.
  - Both “new issue” and “already exists” paths acknowledge the matching payload.
  - Failed issue delivery does not update `board/alerted.json`.
  - Integration tests cover all three workflows' delivery contract.

## 5. Decisions we need from the product owner

These questions materially change behavior and should be answered before implementation:

1. Is the board meant to maximize recall, or should it show only jobs likely to be applied to?
2. How old can a posting be before it is no longer useful?
3. Should unknown-season internships remain eligible?
4. Should defense, finance, or other industries be excluded from the board, or only from alerts?
5. Is the primary consumption surface Markdown, the local dashboard, GitHub Issues, or a future searchable web board?
6. Should community-feed jobs be visually distinguished from official direct-source jobs?
7. When the same URL reappears after months, should it alert again?
8. What monthly GitHub Actions budget is acceptable?

## 6. Proposal template

Copy this section for each new proposal:

```markdown
### IMP-___ — Short title

- **Priority:** P0/P1/P2/P3
- **State:** idea/needs evidence/ready/in progress/shipped/rejected
- **Owner:**
- **Problem:**
- **Evidence/baseline:**
- **Proposed behavior:**
- **Non-goals:**
- **Data/schema changes:**
- **Migration/rollout:**
- **Failure and rollback behavior:**
- **Observability:**
- **Acceptance criteria:**
  - [ ]
- **Test plan:**
- **Open questions:**
```

## 7. Decision log

| Date | Proposal | Decision | Reason |
|---|---|---|---|
| — | — | No decisions yet | — |

## 8. Release plan

Leave this blank until the first proposals are accepted.

### Milestone 1

- Goal:
- Included proposals:
- Rollout:
- Rollback:

### Milestone 2

- Goal:
- Included proposals:
- Rollout:
- Rollback:
