import fs from "node:fs";
import path from "node:path";

/**
 * Committed state for the weekly local company-scout job (see
 * company-scout.ts). Split into its own file specifically so board-cli.ts
 * (which every CI workflow runs) can read the scout's PAST output without
 * importing anything that references the Claude CLI at all — same
 * discipline as browser-scrape.ts vs. run.ts. CI never runs the scout
 * itself; it only ever reads whatever board/scout-companies.json already
 * says, same as any other committed config file.
 */

export interface ScoutState {
  companies: string[];
  lastRunAt: string | null;
}

const STATE_FILE = path.join(process.cwd(), "board", "scout-companies.json");

export function loadScoutState(): ScoutState {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { companies: Array.isArray(state.companies) ? state.companies : [], lastRunAt: state.lastRunAt ?? null };
  } catch {
    return { companies: [], lastRunAt: null };
  }
}

export function loadScoutCompanies(): string[] {
  return loadScoutState().companies;
}

export function saveScoutState(state: ScoutState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
}
