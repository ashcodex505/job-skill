import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { badRequest, handler, ok } from "@/lib/api";
import { parsePriorityCompanies, serializePriorityCompanies } from "@/lib/career/priority";
import { syncWatchWorkflow } from "@/lib/github";
import { COMPANY_PORTALS } from "@/scraper/registry";

const execFileAsync = promisify(execFile);

const CAREER_DIR = process.env.CAREER_DIR ?? path.join(process.cwd(), "career");
const FILE = path.join(CAREER_DIR, "priority-companies.md");

/** Only companies with a real ATS adapter can be usefully checked every hour. */
const ELIGIBLE = new Map(COMPANY_PORTALS.filter((p) => p.ats !== "unsupported").map((p) => [p.name.toLowerCase(), p.name]));

function readCompanies(): string[] {
  try {
    return parsePriorityCompanies(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

/** Atomic replace: write a temp file in the same dir, then rename over. */
function writeCompanies(companies: string[]): void {
  fs.mkdirSync(CAREER_DIR, { recursive: true });
  const tmp = path.join(CAREER_DIR, `.priority-companies.${process.pid}.tmp`);
  fs.writeFileSync(tmp, serializePriorityCompanies(companies));
  fs.renameSync(tmp, FILE);
}

async function isDirty(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--", FILE], {
      cwd: process.cwd(),
      timeout: 5000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Same auto-sync pattern as the watchlist route — see its comment for the retry rationale. */
async function gitSync(): Promise<string | null> {
  const git = (args: string[]) => execFileAsync("git", args, { cwd: process.cwd(), timeout: 60_000 });
  try {
    await git(["add", "--", FILE]);
    try {
      await git(["commit", "-m", "chore: update priority companies from dashboard", "--", FILE]);
    } catch {
      return null; // nothing to commit — already in sync
    }
    try {
      await git(["push"]);
    } catch {
      await git(["pull", "--rebase", "--autostash", "origin", "main"]);
      await git(["push"]);
    }
    return null;
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return `Auto-sync to GitHub failed (${detail}) — commit & push career/priority-companies.md manually.`;
  }
}

async function state(syncError: string | null = null) {
  return ok({
    companies: readCompanies(),
    eligibleCompanies: [...ELIGIBLE.values()].sort(),
    dirty: await isDirty(),
    syncError,
  });
}

export const GET = handler(async () => state());

const companyInput = z.object({ company: z.string().trim().min(1).max(120) });

export const POST = handler(async (req: Request) => {
  const { company } = companyInput.parse(await req.json());
  const canonical = ELIGIBLE.get(company.toLowerCase());
  if (!canonical) {
    return badRequest(
      `"${company}" isn't scraped through a direct adapter, so an hourly check wouldn't do anything — it would only ever run on the 12h sweep regardless.`,
    );
  }
  if (canonical.toLowerCase() === "amazon") {
    return badRequest("Amazon is already checked every hour by default — no need to add it.");
  }
  const companies = readCompanies();
  if (companies.some((c) => c.toLowerCase() === canonical.toLowerCase())) {
    return badRequest(`${canonical} is already on the priority list`);
  }
  writeCompanies([...companies, canonical]);
  const errors = [await gitSync(), await syncWatchWorkflow(true)].filter(Boolean);
  return state(errors.length ? errors.join(" ") : null);
});

export const DELETE = handler(async (req: Request) => {
  const { company } = companyInput.parse(await req.json());
  const companies = readCompanies();
  const remaining = companies.filter((c) => c.toLowerCase() !== company.toLowerCase());
  if (remaining.length === companies.length) return badRequest("Company not found on the priority list");
  writeCompanies(remaining);
  const errors = [await gitSync()].filter(Boolean);
  return state(errors.length ? errors.join(" ") : null);
});
