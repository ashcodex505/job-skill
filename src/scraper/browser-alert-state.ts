import fs from "node:fs";
import path from "node:path";
import type { AlertLedger } from "./big-tech-alert";

/**
 * A dedicated "already notified" ledger for browser-scan-sourced GitHub
 * Issue alerts (board/browser-alerted.json) — deliberately NOT the same
 * file as board/alerted.json, which board-cli.ts/CI also write. Keeping
 * this one separate means a local browser-scan notification run can never
 * race a CI commit to the shared ledger.
 */
const LEDGER_PATH = path.join(process.cwd(), "board", "browser-alerted.json");

export function loadBrowserAlertLedger(): AlertLedger {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveBrowserAlertLedger(ledger: AlertLedger): void {
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 1) + "\n", "utf8");
}
