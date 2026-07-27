import { runPool } from "@/lib/concurrency";
import { ADAPTERS, fetchJson } from "./adapters";
import type { RawJob } from "./normalize";
import type { CompanyPortal } from "./registry";

/**
 * Reverse ATS discovery — ported from career-ops' scan-ats-full.mjs. Where
 * registry.ts scans the companies YOU curated, this walks a public directory
 * of companies per ATS and surfaces postings from companies you never
 * manually added — no curation needed to find them.
 *
 * Company directories come from the public job-board-aggregator dataset
 * (github.com/Feashliaa/job-board-aggregator) — tens of thousands of
 * companies across Greenhouse, Lever, Ashby, and BambooHR. Workday is
 * deliberately excluded here: its adapter makes several sequential
 * requests per company (broadened search terms × pagination), which is
 * fine for ~80 curated companies but not for a directory scan meant to
 * sweep thousands.
 *
 * Bounded and resumable, unlike career-ops' one-shot manual script: this
 * repo's scraper is scheduled, not manually invoked, so scanning the whole
 * ~28,000-company directory every run would be both slow and impolite. A
 * committed cursor (board/discovery-cursor.json, one integer per ATS)
 * advances a fixed-size window through each dataset every run and wraps
 * back to 0 once it reaches the end — so coverage is a slow, continuous
 * sweep across many runs instead of a repeated scan of the same slice.
 */

const DATASET_BASE = "https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data";

const DATASET_FILES: { ats: "greenhouse" | "lever" | "ashby" | "bamboohr"; file: string }[] = [
  { ats: "greenhouse", file: "greenhouse_companies.json" },
  { ats: "lever", file: "lever_companies.json" },
  { ats: "ashby", file: "ashby_companies.json" },
  { ats: "bamboohr", file: "bamboohr_companies.json" },
];

/** Companies scanned per ATS per run. 4 ATS types × this = the real per-run request volume. */
const PER_RUN_CAP_PER_ATS = 150;
const DISCOVERY_CONCURRENCY = 8;

export type DiscoveryCursor = Partial<Record<(typeof DATASET_FILES)[number]["ats"], number>>;

/** Slug charset guard — the dataset is external input destined for URL interpolation. */
const SLUG_RE = /^[A-Za-z0-9._-]+$/;

export interface DiscoveryResult {
  jobs: RawJob[];
  nextCursor: DiscoveryCursor;
  /** { ats: companiesScanned } — used for the run summary and scanned-source tracking. */
  scanned: Partial<Record<string, number>>;
  errors: { company: string; message: string }[];
}

export async function scrapeReverseDiscovery(cursor: DiscoveryCursor): Promise<DiscoveryResult> {
  const jobs: RawJob[] = [];
  const nextCursor: DiscoveryCursor = { ...cursor };
  const scanned: Partial<Record<string, number>> = {};
  const errors: { company: string; message: string }[] = [];

  for (const { ats, file } of DATASET_FILES) {
    let slugs: string[];
    try {
      slugs = await fetchJson<string[]>(`${DATASET_BASE}/${file}`);
    } catch (err) {
      errors.push({ company: `discovery:${ats}`, message: err instanceof Error ? err.message : String(err) });
      continue; // one dataset file failing shouldn't kill the others
    }
    slugs = slugs.filter((s) => typeof s === "string" && SLUG_RE.test(s));
    if (slugs.length === 0) continue;

    const start = (cursor[ats] ?? 0) % slugs.length;
    const window: string[] = [];
    for (let i = 0; i < Math.min(PER_RUN_CAP_PER_ATS, slugs.length); i++) window.push(slugs[(start + i) % slugs.length]);
    nextCursor[ats] = (start + window.length) % slugs.length;

    let scannedCount = 0;
    await runPool(window, DISCOVERY_CONCURRENCY, async (slug) => {
      const portal: CompanyPortal = { name: slug, website: "", careersUrl: "", ats, slug };
      try {
        const raw = await ADAPTERS[ats](portal);
        // Discovery-sourced jobs are owned by the discovery feed, not by any
        // curated registry entry — retagged so board.ts's absence-≠-closure
        // lifecycle and the dedupe-across-sources logic treat them correctly
        // (an adapter copy from a company you've ALSO manually registered
        // still wins on dedupe, since normalize.ts prefers non-feed sources).
        for (const j of raw) jobs.push({ ...j, source: "reverse-discovery", company: j.company || slug });
        scannedCount++;
      } catch (err) {
        // A broken/renamed/defunct slug in a third-party dataset is expected
        // noise at this scale — log it, don't fail the run over it.
        errors.push({ company: `discovery:${ats}:${slug}`, message: err instanceof Error ? err.message : String(err) });
      }
    });
    scanned[`discovery:${ats}`] = scannedCount;
  }

  return { jobs, nextCursor, scanned, errors };
}
