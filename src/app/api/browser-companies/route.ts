import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { badRequest, handler, ok } from "@/lib/api";
import { parseBrowserCompanies, serializeBrowserCompanies, type BrowserCompanyEntry } from "@/lib/career/browser-companies";

const execFileAsync = promisify(execFile);

const CAREER_DIR = process.env.CAREER_DIR ?? path.join(process.cwd(), "career");
const FILE = path.join(CAREER_DIR, "browser-companies.md");

function readCompanies(): BrowserCompanyEntry[] {
  try {
    return parseBrowserCompanies(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

/** Atomic replace: write a temp file in the same dir, then rename over. */
function writeCompanies(companies: BrowserCompanyEntry[]): void {
  fs.mkdirSync(CAREER_DIR, { recursive: true });
  const tmp = path.join(CAREER_DIR, `.browser-companies.${process.pid}.tmp`);
  fs.writeFileSync(tmp, serializeBrowserCompanies(companies));
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

/** Same auto-sync pattern as the watchlist/priority-companies routes — see their comments for the retry rationale. */
async function gitSync(): Promise<string | null> {
  const git = (args: string[]) => execFileAsync("git", args, { cwd: process.cwd(), timeout: 60_000 });
  try {
    await git(["add", "--", FILE]);
    try {
      await git(["commit", "-m", "chore: update browser-scan companies from dashboard", "--", FILE]);
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
    return `Auto-sync to GitHub failed (${detail}) — commit & push career/browser-companies.md manually.`;
  }
}

async function state(syncError: string | null = null) {
  return ok({ companies: readCompanies(), dirty: await isDirty(), syncError });
}

export const GET = handler(async () => state());

const companyInput = z.object({
  name: z.string().trim().min(1).max(120),
  careersUrl: z.string().trim().url().max(500),
});

export const POST = handler(async (req: Request) => {
  const { name, careersUrl } = companyInput.parse(await req.json());
  const companies = readCompanies();
  if (companies.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return badRequest(`${name} is already on the browser-scan list`);
  }
  writeCompanies([...companies, { name, careersUrl }]);
  const errors = [await gitSync()].filter(Boolean);
  return state(errors.length ? errors.join(" ") : null);
});

export const DELETE = handler(async (req: Request) => {
  const { name } = z.object({ name: z.string().trim().min(1) }).parse(await req.json());
  const companies = readCompanies();
  const remaining = companies.filter((c) => c.name.toLowerCase() !== name.toLowerCase());
  if (remaining.length === companies.length) return badRequest("Company not found on the browser-scan list");
  writeCompanies(remaining);
  const errors = [await gitSync()].filter(Boolean);
  return state(errors.length ? errors.join(" ") : null);
});
