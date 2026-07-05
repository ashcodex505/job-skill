import { ADAPTERS, sleep } from "./adapters";
import { COMPANY_PORTALS } from "./registry";

/**
 * `npm run scrape:check` — slug doctor. Hits every registry entry's real
 * endpoint and prints a table (company, ats, status, posting count) so a
 * renamed board or wrong slug is caught when adding companies rather than
 * silently returning zero jobs forever. Exit code 1 if anything fails.
 */
async function main() {
  const rows: { company: string; ats: string; status: string; postings: string }[] = [];
  let failures = 0;

  for (const portal of COMPANY_PORTALS) {
    if (portal.ats === "unsupported") {
      rows.push({ company: portal.name, ats: portal.ats, status: "SKIP", postings: "—" });
      continue;
    }
    try {
      const jobs = await ADAPTERS[portal.ats](portal);
      // 0 postings is suspicious for these companies — flag but don't fail.
      rows.push({
        company: portal.name,
        ats: portal.ats,
        status: jobs.length > 0 ? "OK" : "OK (0 ⚠️)",
        postings: String(jobs.length),
      });
    } catch (err) {
      failures += 1;
      rows.push({
        company: portal.name,
        ats: portal.ats,
        status: `FAIL — ${err instanceof Error ? err.message : String(err)}`,
        postings: "—",
      });
    }
    await sleep(300);
  }

  const w1 = Math.max(...rows.map((r) => r.company.length), 7);
  const w2 = Math.max(...rows.map((r) => r.ats.length), 3);
  console.log(`\n${"Company".padEnd(w1)}  ${"ATS".padEnd(w2)}  ${"Postings".padEnd(8)}  Status`);
  console.log("-".repeat(w1 + w2 + 30));
  for (const r of rows) {
    console.log(`${r.company.padEnd(w1)}  ${r.ats.padEnd(w2)}  ${r.postings.padEnd(8)}  ${r.status}`);
  }
  const supported = rows.filter((r) => r.status !== "SKIP");
  console.log(
    `\n${supported.length} supported portals: ${supported.length - failures} OK, ${failures} failed, ${rows.length - supported.length} unsupported (manual check).`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
