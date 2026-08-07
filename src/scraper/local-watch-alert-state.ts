import fs from "node:fs";
import path from "node:path";
import type { AlertLedger } from "./big-tech-alert";
import type { BoardJob } from "./board";

export interface LocalWatchAlertState {
  initialized: boolean;
  alerted: AlertLedger;
  /** Jobs awaiting a successfully-created issue (survives auth/network errors). */
  pending: BoardJob[];
}

const STATE_PATH = path.join(process.cwd(), "data", "local-watch-alerts.json");

export function loadLocalWatchAlertState(): LocalWatchAlertState {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return {
      initialized: parsed.initialized === true,
      alerted: parsed.alerted && typeof parsed.alerted === "object" ? parsed.alerted : {},
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
    };
  } catch {
    return { initialized: false, alerted: {}, pending: [] };
  }
}

export function saveLocalWatchAlertState(state: LocalWatchAlertState): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 1)}\n`, "utf8");
}
