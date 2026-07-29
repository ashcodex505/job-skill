import fs from "node:fs";
import path from "node:path";
import { handler, ok } from "@/lib/api";
import { loadCareerConfig } from "@/lib/career/config";
import { runCompanyScout } from "@/scraper/company-scout";
import { loadScoutState } from "@/scraper/scout-state";

/**
 * Local-only weekly company-scout trigger — see docs/browser-scraping.md's
 * sibling doc (company-scout section in docs/architecture.md) for the full
 * design. Structurally the same isolation pattern as
 * POST /api/scrape/browser: only ever reachable while the local Next.js
 * server is running, never from any GitHub Actions workflow, because the
 * local `claude` CLI has no equivalent credential available to a CI runner.
 */
const THROTTLE_MS = 7 * 24 * 60 * 60 * 1000;
const g = globalThis as unknown as { __rtScoutRunning?: boolean };

function readBoardCompanies(): string[] {
  try {
    const board = JSON.parse(fs.readFileSync(path.join(process.cwd(), "board", "jobs.json"), "utf8"));
    return (board.jobs ?? []).map((j: { company: string }) => j.company);
  } catch {
    return [];
  }
}

export const POST = handler(async (req: Request) => {
  const force = new URL(req.url).searchParams.get("force") === "true";
  const state = loadScoutState();
  if (g.__rtScoutRunning) return ok({ ran: false, reason: "scout already running" });
  if (!force && state.lastRunAt && Date.now() - new Date(state.lastRunAt).getTime() < THROTTLE_MS) {
    return ok({ ran: false, reason: "throttled — runs at most once a week", lastRunAt: state.lastRunAt });
  }

  g.__rtScoutRunning = true;
  try {
    const boardCompanies = readBoardCompanies();
    const approvedCompanies = loadCareerConfig().summer2027ApprovedCompanies;
    const result = await runCompanyScout(boardCompanies, approvedCompanies);
    return ok(result);
  } finally {
    g.__rtScoutRunning = false;
  }
});

export const GET = handler(async () => ok(loadScoutState()));

// A judgment pass over many candidates can take a while; give it real room.
export const maxDuration = 300;
