import fs from "node:fs";
import { buildJobAlertIssueBody } from "./job-alert";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const currentFile = required("JOB_ALERT_CURRENT_FILE");
const previousFile = required("JOB_ALERT_PREVIOUS_FILE");
const outputFile = required("JOB_ALERT_OUTPUT_FILE");
const runAt = required("JOB_ALERT_RUN_AT");
const owner = required("JOB_ALERT_OWNER");
const count = Number(required("JOB_ALERT_COUNT"));
if (!Number.isInteger(count) || count < 1) throw new Error("JOB_ALERT_COUNT must be a positive integer");

const previousBody = fs.existsSync(previousFile) ? fs.readFileSync(previousFile, "utf8") : "";
const table = fs.readFileSync(currentFile, "utf8");
fs.writeFileSync(outputFile, buildJobAlertIssueBody(previousBody, { runAt, count, table }, owner));
