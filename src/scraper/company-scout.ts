import { claudeAvailable, ClaudeUnavailableError, runClaude } from "@/lib/claude";
import { BIG_TECH_COMPANIES, EXCLUDED_COMPANIES } from "./big-tech-alert";
import { isApprovedCompany } from "./normalize";
import { loadScoutState, saveScoutState } from "./scout-state";

/**
 * Weekly local judgment pass: ask the local Claude Code CLI which companies
 * currently showing up in your job feeds are genuinely big-tech/unicorn
 * tier, so BIG_TECH_COMPANIES's hand-curated list doesn't need you (or a
 * fresh editing session) to notice a gap and expand it manually forever.
 *
 * Local-only, deliberately — same reasoning as browser-scrape.ts. The
 * `claude` CLI authenticates against whatever's already logged in on this
 * machine; a GitHub Actions runner has no such session, and giving it one
 * would mean storing a credential as a repo secret regardless of whether
 * it's shaped like an API key or something else. Running this locally is
 * what actually avoids that, not a property of the CLI itself. This file
 * must never be imported by board-cli.ts, run.ts's default path, or any
 * .github/workflows/*.yml — only src/app/api/scrape/scout/route.ts calls
 * runCompanyScout(); everything else reads scout-state.ts's committed
 * output instead.
 */

/** Companies currently on the board that aren't already alert-eligible some other way. Exported for tests. */
export function findScoutCandidates(boardCompanies: string[], approvedCompanies: string[], alreadyScouted: string[]): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const name of boardCompanies) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isApprovedCompany(name, BIG_TECH_COMPANIES)) continue;
    if (isApprovedCompany(name, EXCLUDED_COMPANIES)) continue;
    if (isApprovedCompany(name, approvedCompanies)) continue;
    if (isApprovedCompany(name, alreadyScouted)) continue;
    candidates.push(name);
  }
  return candidates;
}

/**
 * Parses + validates Claude's raw response against the candidate list that
 * was actually offered — the completion is NEVER trusted to only echo back
 * real candidates (same rule as /api/career's plain-English editor). Returns
 * null for a response that isn't a well-formed JSON array of strings.
 * Exported for tests.
 */
export function parseScoutResponse(response: string, candidates: string[]): string[] | null {
  let parsed: unknown;
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) return null;

  const candidateSet = new Map(candidates.map((c) => [c.toLowerCase(), c]));
  return [...new Set(parsed.map((name) => candidateSet.get(name.toLowerCase())).filter((v): v is string => Boolean(v)))];
}

export interface ScoutResult {
  ran: boolean;
  reason?: string;
  candidatesChecked?: number;
  added?: string[];
}

/**
 * Runs one judgment pass. `boardCompanies` should be every distinct company
 * name currently on the board (the caller reads board/jobs.json) — this
 * only ever asks about companies that are ALREADY real, ALREADY posting
 * into your feeds, never invented ones, and Claude's response is
 * cross-checked against that same candidate list before anything is
 * written (same "never trust the completion blindly" rule as
 * /api/career's plain-English editor).
 */
export async function runCompanyScout(boardCompanies: string[], approvedCompanies: string[]): Promise<ScoutResult> {
  if (!(await claudeAvailable())) {
    return { ran: false, reason: "Claude Code CLI not installed — run `npm i -g @anthropic-ai/claude-code` and log in to enable this." };
  }

  const state = loadScoutState();
  const candidates = findScoutCandidates(boardCompanies, approvedCompanies, state.companies);
  if (candidates.length === 0) {
    return { ran: false, reason: "no new candidate companies since the last pass" };
  }

  const prompt = `You are reviewing a list of real company names that are currently posting software-engineering internship or new-grad job listings, gathered from live job boards. Your job: identify which of these are genuinely "big tech or unicorn tier" — meaning a major, widely-recognized public technology company, OR a private company genuinely valued at $1B+ (a real unicorn), OR an unusually prestigious/high-signal startup a strong CS student would recognize by name. Do NOT include: quant trading firms, hedge funds, prop trading shops, banks, card networks, payment processors, staffing agencies, consulting firms, generic enterprise software vendors, or any company you are not confident meets the bar. Err toward excluding when unsure — this is a high-signal list, not a broad one.

Companies to evaluate (one per line):
${candidates.map((c) => `- ${c}`).join("\n")}

Respond with ONLY a JSON array of the company names (exactly as written above) that meet the bar. No commentary, no markdown code fences, no explanation. If none qualify, respond with []`;

  let response: string;
  try {
    response = await runClaude(prompt);
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) return { ran: false, reason: err.message };
    throw err;
  }

  const added = parseScoutResponse(response, candidates);
  if (added === null) {
    return { ran: false, reason: "Claude's response wasn't a JSON array of strings — try again next cycle." };
  }

  saveScoutState({ companies: [...state.companies, ...added], lastRunAt: new Date().toISOString() });
  return { ran: true, candidatesChecked: candidates.length, added };
}
