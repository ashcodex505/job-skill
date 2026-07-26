import { eq, inArray, notInArray, and } from "drizzle-orm";
import { db, newId, now, tables } from "@/db";
import { loadCareerConfig } from "@/lib/career/config";
import { ADAPTERS, scrapeSimplifyFeeds, scrapeSpeedyApplyFeeds, scrapeVanshFeed, sleep } from "./adapters";
import { resolvePostedAt } from "./board";
import { dedupeJobs, FEED_SOURCES, normalizeJob, type NormalizedJob } from "./normalize";
import { COMPANY_PORTALS, type CompanyPortal } from "./registry";

const COMPANY_DELAY_MS = 400; // polite gap between companies

export interface ScrapeSummary {
  runId: string;
  companiesScanned: number;
  /** Companies whose adapter succeeded this run (absence ≠ closure otherwise). */
  scannedCompanies: string[];
  /** Whole-feed sources that succeeded this run (e.g. "simplifyjobs"). */
  scannedSources: string[];
  jobsFound: number;
  newJobs: number;
  errors: { company: string; message: string }[];
  jobs: NormalizedJob[];
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

export async function runScraper(
  options: { companies?: string[]; simplifyFeed?: boolean } = {},
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
  const allJobs: NormalizedJob[] = [];
  const scannedCompanies: string[] = [];
  const scannedSources: string[] = [];
  // The community feed joins full runs by default; partial --company runs opt in.
  const includeFeed = options.simplifyFeed ?? !wanted;

  for (const portal of portals) {
    try {
      const raw = await ADAPTERS[portal.ats](portal);
      const normalized = raw
        .map((job) => normalizeJob(job, careerConfig))
        .filter((j): j is NormalizedJob => j !== null);
      allJobs.push(...normalized);
      scannedCompanies.push(portal.name);
      console.log(`  ${portal.name}: ${raw.length} postings, ${normalized.length} relevant`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ company: portal.name, message });
      console.warn(`  ${portal.name}: FAILED — ${message}`);
    }
    await sleep(COMPANY_DELAY_MS);
  }

  if (includeFeed) {
    const feeds = [
      { name: "SimplifyJobs feed", source: "simplifyjobs", scrape: scrapeSimplifyFeeds },
      { name: "speedyapply feed", source: "speedyapply", scrape: scrapeSpeedyApplyFeeds },
      { name: "vanshb03 feed", source: "vansh", scrape: scrapeVanshFeed },
    ] as const;
    for (const feed of feeds) {
      try {
        const raw = await feed.scrape();
        const normalized = raw.map((job) => normalizeJob(job, careerConfig)).filter((j): j is NormalizedJob => j !== null);
        allJobs.push(...normalized);
        scannedSources.push(feed.source);
        console.log(`  ${feed.name}: ${raw.length} recent listings, ${normalized.length} relevant`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ company: feed.name, message });
        console.warn(`  ${feed.name}: FAILED — ${message}`);
      }
    }
  }

  const jobs = dedupeJobs(allJobs);
  const timestamp = now();
  let newJobs = 0;

  for (const job of jobs) {
    const existing = await db.query.discoveredJobs.findFirst({
      where: eq(tables.discoveredJobs.dedupeKey, job.dedupeKey),
    });
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
    errors,
    jobs,
  };
}
