import type { CompanyPortal } from "./registry";

export type CoverageMode = "direct" | "browser" | "community-feed" | "manual";

export interface CompanyCoverage {
  company: string;
  mode: CoverageMode;
  source: string;
  careersUrl: string | null;
  registered: boolean;
}

/**
 * Resolve every approved company to an explicit collection path. Direct ATS
 * adapters win, followed by the live browser-scan config. Unsupported portal
 * metadata records the audited fallback instead of allowing a silent skip.
 */
export function buildCompanyCoverage(
  approvedCompanies: string[],
  portals: CompanyPortal[],
  browserCompanies: string[],
): CompanyCoverage[] {
  const portalByName = new Map(portals.map((portal) => [portal.name.toLowerCase(), portal]));
  const browserNames = new Set(browserCompanies.map((name) => name.toLowerCase()));

  return approvedCompanies.map((company) => {
    const portal = portalByName.get(company.toLowerCase());
    if (!portal) {
      return { company, mode: "manual", source: "missing registry entry", careersUrl: null, registered: false };
    }
    if (portal.ats !== "unsupported") {
      return { company, mode: "direct", source: portal.ats, careersUrl: portal.careersUrl, registered: true };
    }
    if (browserNames.has(company.toLowerCase())) {
      return { company, mode: "browser", source: "local browser scan", careersUrl: portal.careersUrl, registered: true };
    }
    const mode = portal.fallbackCoverage ?? "manual";
    return {
      company,
      mode,
      source: mode === "community-feed" ? "community feeds (not guaranteed)" : "manual check",
      careersUrl: portal.careersUrl,
      registered: true,
    };
  });
}

export function renderCoverageMarkdown(rows: CompanyCoverage[]): string {
  const modes: CoverageMode[] = ["direct", "browser", "community-feed", "manual"];
  const counts = new Map(modes.map((mode) => [mode, rows.filter((row) => row.mode === mode).length]));
  const nonDirect = rows.filter((row) => row.mode !== "direct");
  const lines = [
    "## Approved-company scraper coverage",
    "",
    `- Direct scheduled adapters: **${counts.get("direct")}**`,
    `- Local browser scan: **${counts.get("browser")}**`,
    `- Community-feed fallback: **${counts.get("community-feed")}**`,
    `- Manual-only: **${counts.get("manual")}**`,
    "",
    "| Company | Coverage | Source |",
    "|---|---|---|",
    ...nonDirect.map((row) => `| ${row.company.replace(/\|/g, "\\|")} | ${row.mode} | ${row.source} |`),
  ];
  return `${lines.join("\n")}\n`;
}
