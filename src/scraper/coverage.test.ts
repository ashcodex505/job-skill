import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBrowserCompanies } from "@/lib/career/browser-companies";
import { parseCareerConfig } from "@/lib/career/config";
import { buildCompanyCoverage, renderCoverageMarkdown } from "./coverage";
import { COMPANY_PORTALS } from "./registry";

const root = process.cwd();
const profile = fs.readFileSync(path.join(root, "career", "profile.md"), "utf8");
const preferences = fs.readFileSync(path.join(root, "career", "preferences.md"), "utf8");
const browserMarkdown = fs.readFileSync(path.join(root, "career", "browser-companies.md"), "utf8");
const approved = parseCareerConfig(profile, preferences).summer2027ApprovedCompanies;
const browser = parseBrowserCompanies(browserMarkdown).map((entry) => entry.name);

describe("approved-company scraper coverage", () => {
  const rows = buildCompanyCoverage(approved, COMPANY_PORTALS, browser);

  it("registers every approved company with an explicit coverage path", () => {
    expect(rows).toHaveLength(approved.length);
    expect(rows.filter((row) => !row.registered)).toEqual([]);
    expect(COMPANY_PORTALS.filter((portal) => portal.ats === "unsupported" && !portal.fallbackCoverage)).toEqual([]);
  });

  it("keeps browser metadata aligned with the app-managed browser list", () => {
    const configured = new Set(browser.map((name) => name.toLowerCase()));
    const browserFallbacks = COMPANY_PORTALS.filter((portal) => portal.fallbackCoverage === "browser");
    expect(browserFallbacks.filter((portal) => !configured.has(portal.name.toLowerCase()))).toEqual([]);
  });

  it("reports the newly verified Workday companies as direct coverage", () => {
    for (const company of ["Autodesk", "Expedia", "HP", "Qualcomm", "Yahoo", "Zoom"]) {
      expect(rows.find((row) => row.company === company)).toMatchObject({ mode: "direct", source: "workday" });
    }
  });

  it("reports the frontier AI additions as direct coverage", () => {
    for (const company of ["Cerebras", "Cognition", "Physical Intelligence", "Reflection AI", "Sierra", "SSI"]) {
      expect(rows.find((row) => row.company === company)).toMatchObject({ mode: "direct", source: "ashby" });
    }
    expect(rows.find((row) => row.company === "Together AI")).toMatchObject({ mode: "direct", source: "greenhouse" });
  });

  it("renders non-direct gaps without turning them into issue notifications", () => {
    const markdown = renderCoverageMarkdown(rows);
    expect(markdown).toContain("Approved-company scraper coverage");
    expect(markdown).toContain("| Uber | manual | manual check |");
  });
});
