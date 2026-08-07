import { loadCareerConfig } from "@/lib/career/config";
import { ADAPTERS } from "./adapters";
import { canonicalUrl, explainNormalization } from "./normalize";
import { COMPANY_PORTALS, type CompanyPortal } from "./registry";

const args = process.argv.slice(2);
const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const requestedCompany = valueAfter("--company");
const requestedUrl = valueAfter("--url");

function inferPortal(): CompanyPortal | undefined {
  if (requestedCompany) return COMPANY_PORTALS.find((portal) => portal.name.toLowerCase() === requestedCompany.toLowerCase());
  if (!requestedUrl) return undefined;
  try {
    const url = new URL(requestedUrl);
    if (url.hostname.toLowerCase() === "jobs.ashbyhq.com") {
      const slug = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
      return COMPANY_PORTALS.find((portal) => portal.ats === "ashby" && portal.slug?.toLowerCase() === slug);
    }
    return COMPANY_PORTALS.find((portal) => {
      try {
        return new URL(portal.careersUrl).hostname.toLowerCase() === url.hostname.toLowerCase();
      } catch {
        return false;
      }
    });
  } catch {
    return undefined;
  }
}

async function main() {
  const portal = inferPortal();
  if (!portal || portal.ats === "unsupported" || !(portal.ats in ADAPTERS)) {
    throw new Error("Could not identify a supported company. Pass --company <registry name> and optionally --url <posting URL>.");
  }

  const rawJobs = await ADAPTERS[portal.ats as keyof typeof ADAPTERS](portal);
  const target = requestedUrl
    ? rawJobs.find((job) => canonicalUrl(job.url) === canonicalUrl(requestedUrl))
    : rawJobs[0];
  if (!target) {
    console.log(JSON.stringify({ company: portal.name, sourceFound: false, postingsReturned: rawJobs.length }, null, 2));
    process.exitCode = 2;
    return;
  }

  const explanation = explainNormalization(target, loadCareerConfig());
  console.log(JSON.stringify({ company: portal.name, sourceFound: true, raw: target, ...explanation }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
