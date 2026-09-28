import { eq, inArray, notInArray, and } from "drizzle-orm";
import { db, newId, now, tables } from "@/db";
import { loadCareerConfig } from "@/lib/career/config";
import { runPool } from "@/lib/concurrency";
import {
  ADAPTERS,
  isExpectedWorkdayMaintenanceError,
  scrapeSimplifyFeeds,
  scrapeSpeedyApplyFeeds,
  scrapeVanshFeed,
  sleep,
} from "./adapters";
import { resolvePostedAt } from "./board";
import { scrapeReverseDiscovery, type DiscoveryCursor } from "./discover";
import { dedupeJobs, explainNormalization, FEED_SOURCES, normalizeJob, type NormalizedJob } from "./normalize";
import { COMPANY_PORTALS, type CompanyPortal } from "./registry";

const COMPANY_DELAY_MS = 400; // polite per-lane gap, unchanged even under concurrency
// Matches LINKCHECK_CONCURRENCY's existing precedent in board-cli.ts. Bounds
// the worst-case concurrent hits to any single ATS host (e.g. all 44
// Greenhouse companies share boards-api.greenhouse.io) to this many, no
// matter how many companies use that ATS.
const COMPANY_CONCURRENCY = 5;

/**
 * registry.ts declares portals grouped by ATS (44 Greenhouse in a row, then
 * Lever, then Ashby, ...), so a naive shared-queue pool would spend its
 * first several rounds with every lane concurrently hitting
 * boards-api.greenhouse.io. Round-robin interleaving by ATS type spreads
 * concurrent lanes across different hosts as much as possible instead.
 */
function interleaveByAts(portals: CompanyPortal[]): CompanyPortal[] {
  const groups = new Map<string, CompanyPortal[]>();
  for (const p of portals) {
    if (!groups.has(p.ats)) groups.set(p.ats, []);
    groups.get(p.ats)!.push(p);
  }
  const queues = [...groups.values()];
  const out: CompanyPortal[] = [];
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

export interface ScrapeSummary {
  runId: string;
  companiesScanned: number;
  /** Companies whose adapter succeeded this run (absence ≠ closure otherwise). */
  scannedCompanies: string[];
  /** Whole-feed sources that succeeded this run (e.g. "simplifyjobs"). */
  scannedSources: string[];
  jobsFound: number;
  newJobs: number;
  /** Dedupe keys inserted into the local database during this run. */
  newJobKeys: string[];
  errors: { company: string; message: string }[];
  policyGaps: { company: string; title: string; url: string; reason: string }[];
  jobs: NormalizedJob[];
  /** Only set when options.discover was true — the cursor to persist for next run. */
  nextDiscoveryCursor?: DiscoveryCursor;
}

/** Upsert the portal registry into the companies table; returns name → id. */
export async function syncCompanies(): Promise<Map<string, string>> {
  const existing = await db.select().from(tables.companies);
  const byName = new Map(existing.map((c) => [c.name, c.id]));
  for (const portal of COMPANY_PORTALS) {
    if (byName.has(portal.name)) continue;
    const id = newId();
    await db.insert(tables.companies).values({
      id,
      name: portal.name,
      website: portal.website,
      careersUrl: portal.careersUrl,
      ats: portal.ats,
      atsConfig: JSON.stringify({ slug: portal.slug ?? null, workday: portal.workday ?? null }),
      createdAt: now(),
    });
    byName.set(portal.name, id);
  }
  return byName;
}

/**
 * Insert-or-refresh a deduped batch of NormalizedJob into discovered_jobs.
 * Extracted out of runScraper so callers that never touch the curated
 * registry — the reverse-discovery cursor logic, and specifically the local
 * browser-scrape route (src/app/api/scrape/browser/route.ts) — can reuse the
 * exact same upsert/postedAt-resolution semantics without importing
 * anything that would pull the `playwright` dependency into run.ts's import
 * graph (board-cli.ts, and therefore every CI workflow, imports run.ts).
 */
export async function upsertNormalizedJobs(
  jobs: NormalizedJob[],
  companyIds: Map<string, string>,
): Promise<{ newJobs: number; newJobKeys: string[] }> {
  const timestamp = now();
  let newJobs = 0;
  const newJobKeys: string[] = [];
  // One projection replaces an N+1 lookup per job. A full scrape commonly
  // produces well over a thousand rows, so this removes the largest avoidable
  // source of local SQLite/libSQL round trips without changing write order.
  const existingRows = await db
    .select({
      id: tables.discoveredJobs.id,
      dedupeKey: tables.discoveredJobs.dedupeKey,
      postedAt: tables.discoveredJobs.postedAt,
      firstSeenAt: tables.discoveredJobs.firstSeenAt,
    })
    .from(tables.discoveredJobs);
  const existingByKey = new Map(existingRows.map((row) => [row.dedupeKey, row]));

  for (const job of jobs) {
    const existing = existingByKey.get(job.dedupeKey);
    if (existing) {
      await db
        .update(tables.discoveredJobs)
        .set({
          title: job.title,
          location: job.location,
          url: job.url,
          season: job.season,
          roleType: job.roleType,
          score: job.score,
          matchedSkills: JSON.stringify(job.matchedSkills),
          scoreBreakdown: JSON.stringify(job.breakdown),
          description: job.descriptionText,
          // Keep the earliest provider posted date, never after first-seen —
          // Greenhouse-style updated_at drift must not push "posted" forward.
          postedAt: resolvePostedAt(existing.postedAt, job.postedAt, existing.firstSeenAt),
          lastSeenAt: timestamp,
          active: true,
        })
        .where(eq(tables.discoveredJobs.id, existing.id));
    } else {
      newJobs += 1;
      newJobKeys.push(job.dedupeKey);
      await db.insert(tables.discoveredJobs).values({
        id: newId(),
        source: job.source,
        sourceId: job.sourceId,
        dedupeKey: job.dedupeKey,
        company: job.company,
        companyId: companyIds.get(job.company) ?? null,
        title: job.title,
        location: job.location,
        url: job.url,
        season: job.season,
        roleType: job.roleType,
        score: job.score,
        matchedSkills: JSON.stringify(job.matchedSkills),
        scoreBreakdown: JSON.stringify(job.breakdown),
        description: job.descriptionText,
        postedAt: resolvePostedAt(null, job.postedAt, timestamp),
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        active: true,
      });
    }
  }
  return { newJobs, newJobKeys };
}

export async function runScraper(
  options: { companies?: string[]; simplifyFeed?: boolean; discover?: boolean; discoveryCursor?: DiscoveryCursor } = {},
): Promise<ScrapeSummary> {
  const companyIds = await syncCompanies();
  const wanted = options.companies?.map((c) => c.toLowerCase());
  const portals = COMPANY_PORTALS.filter(
    (p): p is CompanyPortal & { ats: keyof typeof ADAPTERS } =>
      p.ats !== "unsupported" && (!wanted || wanted.includes(p.name.toLowerCase())),
  );

  // career/*.md personalization (career-ops style) — re-read every run.
  const careerConfig = loadCareerConfig();
  if (careerConfig.skills.length > 0) {
    console.log(
      `Career profile loaded: ${careerConfig.skills.length} skills, ${careerConfig.seasons.length} target seasons, ${careerConfig.negativeKeywords.length} exclusions`,
    );
  }

  const runId = newId();
  await db.insert(tables.scraperRuns).values({ id: runId, startedAt: now(), status: "running" });

  const errors: { company: string; message: string }[] = [];
  const policyGaps: ScrapeSummary["policyGaps"] = [];
  const allJobs: NormalizedJob[] = [];
  const scannedCompanies: string[] = [];
  const scannedSources: string[] = [];
  // The community feed joins full runs by default; partial --company runs opt in.
  const includeFeed = options.simplifyFeed ?? !wanted;

  // Up to COMPANY_CONCURRENCY companies are scraped at once. Community feeds
  // use unrelated endpoints, so start their bounded pool at the same time
  // instead of waiting for the entire registry sweep to finish first.
  const companyScan = runPool(interleaveByAts(portals), COMPANY_CONCURRENCY, async (portal) => {
    try {
      const raw = await ADAPTERS[portal.ats](portal);
      const normalized: NormalizedJob[] = [];
      for (const job of raw) {
        const result = explainNormalization(job, careerConfig);
        if (result.job) normalized.push(result.job);
        else if (result.reason === "missing_required_new_grad_phrase") {
          policyGaps.push({ company: job.company, title: job.title, url: job.url, reason: result.reason });
        }
      }
      allJobs.push(...normalized);
      scannedCompanies.push(portal.name);
      console.log(`  ${portal.name}: ${raw.length} postings, ${normalized.length} relevant`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (portal.ats === "workday" && isExpectedWorkdayMaintenanceError(err)) {
        // Workday's planned weekly downtime is not a broken company source.
        // Do not add the company to scannedCompanies: mergeBoard/upsert logic
        // will therefore retain its prior jobs until a later run can verify it.
        console.warn(`  ${portal.name}: SKIPPED — Workday weekly maintenance window`);
      } else {
        errors.push({ company: portal.name, message });
        console.warn(`  ${portal.name}: FAILED — ${message}`);
      }
    }
    await sleep(COMPANY_DELAY_MS);
  });

  const feedScan = includeFeed
    ? (async () => {
        const feeds = [
          { name: "SimplifyJobs feed", source: "simplifyjobs", scrape: scrapeSimplifyFeeds },
          { name: "speedyapply feed", source: "speedyapply", scrape: scrapeSpeedyApplyFeeds },
          { name: "vanshb03 feed", source: "vansh", scrape: scrapeVanshFeed },
        ] as const;
        // All 3 feeds are independent of each other and of the company loop.
        // They share one host (raw.githubusercontent.com), but each feed
        // function is itself sequential internally (its own repo/branch
        // fallbacks and 300ms pacing), so this is at most 3 concurrent
        // requests to a CDN built for far higher concurrency than that.
        await runPool(feeds, feeds.length, async (feed) => {
          try {
            const raw = await feed.scrape();
            const normalized = raw
              .map((job) => normalizeJob(job, careerConfig))
              .filter((j): j is NormalizedJob => j !== null);
            allJobs.push(...normalized);
            scannedSources.push(feed.source);
            console.log(`  ${feed.name}: ${raw.length} recent listings, ${normalized.length} relevant`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            errors.push({ company: feed.name, message });
            console.warn(`  ${feed.name}: FAILED — ${message}`);
          }
        });
      })()
    : Promise.resolve();

  await Promise.all([companyScan, feedScan]);

  // Reverse discovery: opt-in, separate from the curated registry entirely.
  // Deliberately NOT added to scannedCompanies/scannedSources — it only ever
  // scans a rotating slice of a ~28,000-company directory per run, so
  // "discovery ran this cycle" is never evidence that a given company's
  // absence means it closed. Discovered jobs are upserted like any other
  // (refreshed if re-encountered in a later week's window) but are only
  // ever closed by the dead-link checker actually confirming the URL is
  // gone, never by the scanned-source deactivation logic below.
  let nextDiscoveryCursor: DiscoveryCursor | undefined;
  if (options.discover) {
    const result = await scrapeReverseDiscovery(options.discoveryCursor ?? {});
    const normalized = result.jobs.map((job) => normalizeJob(job, careerConfig)).filter((j): j is NormalizedJob => j !== null);
    allJobs.push(...normalized);
    nextDiscoveryCursor = result.nextCursor;
    errors.push(...result.errors);
    for (const [key, count] of Object.entries(result.scanned)) {
      console.log(`  ${key}: ${count} companies scanned`);
    }
  }

  const jobs = dedupeJobs(allJobs);
  const { newJobs, newJobKeys } = await upsertNormalizedJobs(jobs, companyIds);

  // Jobs from successfully scanned companies/feeds NOT seen this run are gone.
  // Feed-sourced rows are owned by the feed, not the company, so a company
  // scan never deactivates them (and vice versa).
  const seenKeys = jobs.map((j) => j.dedupeKey);
  const unseen = seenKeys.length > 0 ? notInArray(tables.discoveredJobs.dedupeKey, seenKeys) : undefined;
  if (scannedCompanies.length > 0) {
    await db
      .update(tables.discoveredJobs)
      .set({ active: false })
      .where(
        and(
          inArray(tables.discoveredJobs.company, scannedCompanies),
          notInArray(tables.discoveredJobs.source, [...FEED_SOURCES]),
          unseen,
        ),
      );
  }
  for (const source of scannedSources) {
    await db
      .update(tables.discoveredJobs)
      .set({ active: false })
      .where(and(eq(tables.discoveredJobs.source, source), unseen));
  }

  await db
    .update(tables.scraperRuns)
    .set({
      finishedAt: now(),
      status: errors.length === portals.length && portals.length > 0 ? "failed" : "completed",
      companiesScanned: scannedCompanies.length,
      jobsFound: jobs.length,
      newJobs,
      errors: JSON.stringify(errors),
    })
    .where(eq(tables.scraperRuns.id, runId));

  return {
    runId,
    companiesScanned: scannedCompanies.length,
    scannedCompanies,
    scannedSources,
    jobsFound: jobs.length,
    newJobs,
    newJobKeys,
    errors,
    policyGaps,
    jobs,
    nextDiscoveryCursor,
  };
}
