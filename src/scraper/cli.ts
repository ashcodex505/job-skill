import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/db";
import { runScraper } from "./run";

/**
 * CLI: npm run scrape [-- --company Stripe --company OpenAI --json out.json]
 * Never touches the credentials table.
 */
async function main() {
  const args = process.argv.slice(2);
  const companies: string[] = [];
  let jsonOut: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--company" && args[i + 1]) companies.push(args[++i]);
    else if (args[i] === "--json" && args[i + 1]) jsonOut = args[++i];
  }

  await migrate(db, { migrationsFolder: "./drizzle" });

  console.log(`Scraping ${companies.length > 0 ? companies.join(", ") : "all supported companies"}...`);
  const summary = await runScraper(companies.length > 0 ? { companies } : {});

  console.log(
    `\nDone: ${summary.companiesScanned} companies, ${summary.jobsFound} relevant jobs, ${summary.newJobs} new.`,
  );
  if (summary.errors.length > 0) {
    console.log(`Errors (${summary.errors.length}):`);
    for (const e of summary.errors) console.log(`  - ${e.company}: ${e.message}`);
  }

  if (jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    fs.writeFileSync(
      jsonOut,
      JSON.stringify(
        {
          scrapedAt: new Date().toISOString(),
          jobs: summary.jobs.map(({ ...j }) => j),
          errors: summary.errors,
        },
        null,
        2,
      ),
    );
    console.log(`Wrote ${jsonOut}`);
  }
  process.exit(summary.jobsFound === 0 && summary.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
