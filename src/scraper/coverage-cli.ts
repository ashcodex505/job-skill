import fs from "node:fs";
import path from "node:path";
import { parseBrowserCompanies } from "@/lib/career/browser-companies";
import { loadCareerConfig } from "@/lib/career/config";
import { buildCompanyCoverage, renderCoverageMarkdown } from "./coverage";
import { COMPANY_PORTALS } from "./registry";

const browserFile = path.join(process.cwd(), "career", "browser-companies.md");
const browserCompanies = parseBrowserCompanies(fs.readFileSync(browserFile, "utf8"));
const rows = buildCompanyCoverage(
  loadCareerConfig().summer2027ApprovedCompanies,
  COMPANY_PORTALS,
  browserCompanies.map((company) => company.name),
);

console.log(renderCoverageMarkdown(rows));
if (rows.some((row) => !row.registered)) process.exitCode = 1;
