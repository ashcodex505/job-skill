import { eq, inArray, notInArray, and } from "drizzle-orm";
import { db, newId, now, tables } from "@/db";
import { ADAPTERS, sleep } from "./adapters";
import { dedupeJobs, normalizeJob, type NormalizedJob } from "./normalize";
import { COMPANY_PORTALS, type CompanyPortal } from "./registry";

const COMPANY_DELAY_MS = 400; // polite gap between companies

export interface ScrapeSummary {
  runId: string;
  companiesScanned: number;
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

export async function runScraper(options: { companies?: string[] } = {}): Promise<ScrapeSummary> {
  const companyIds = await syncCompanies();
  const wanted = options.companies?.map((c) => c.toLowerCase());
  const portals = COMPANY_PORTALS.filter(
    (p): p is CompanyPortal & { ats: keyof typeof ADAPTERS } =>
      p.ats !== "unsupported" && (!wanted || wanted.includes(p.name.toLowerCase())),
  );

  const runId = newId();
  await db.insert(tables.scraperRuns).values({ id: runId, startedAt: now(), status: "running" });

  const errors: { company: string; message: string }[] = [];
  const allJobs: NormalizedJob[] = [];
  const scannedCompanies: string[] = [];

  for (const portal of portals) {
    try {
      const raw = await ADAPTERS[portal.ats](portal);
      const normalized = raw
        .map(normalizeJob)
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
        postedAt: job.postedAt,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        active: true,
      });
    }
  }

  // Jobs from successfully scanned companies that were NOT seen this run are gone.
  if (scannedCompanies.length > 0) {
    const seenKeys = jobs.map((j) => j.dedupeKey);
    await db
      .update(tables.discoveredJobs)
      .set({ active: false })
      .where(
        and(
          inArray(tables.discoveredJobs.company, scannedCompanies),
          seenKeys.length > 0 ? notInArray(tables.discoveredJobs.dedupeKey, seenKeys) : undefined,
        ),
      );
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

  return { runId, companiesScanned: scannedCompanies.length, jobsFound: jobs.length, newJobs, errors, jobs };
}
