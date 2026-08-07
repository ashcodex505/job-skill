import fs from "node:fs";
import path from "node:path";
import { recordAlerted, type AlertLedger } from "./big-tech-alert";
import type { AlertPayload, AlertType } from "./alert-payload";

const args = process.argv.slice(2);
const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const payloadFile = valueAfter("--payload");
const type = valueAfter("--type") as AlertType | undefined;
if (!payloadFile || (type !== "urgent" && type !== "bigtech")) {
  throw new Error("Usage: npm run alert:ack -- --payload <file> --type urgent|bigtech");
}

const payload = JSON.parse(fs.readFileSync(payloadFile, "utf8")) as AlertPayload;
const entry = payload[type];
if (!entry || entry.type !== type || entry.jobs.length === 0) throw new Error(`No ${type} alert payload to acknowledge`);

const ledgerFile = path.join(process.cwd(), "board", "alerted.json");
let ledger: AlertLedger = {};
try {
  ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
} catch {
  // First acknowledgement creates the ledger.
}
fs.writeFileSync(ledgerFile, JSON.stringify(recordAlerted(ledger, entry.jobs, entry.observedAt), null, 1));
console.log(`Acknowledged ${entry.jobs.length} ${type} alert job(s), fingerprint ${entry.fingerprint}`);
