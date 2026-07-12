import { syncApplicationsToGoogleSheetsSafe } from "@/lib/integrations/google-sheets";

async function main() {
  const result = await syncApplicationsToGoogleSheetsSafe("CLI");

  if (result.status === "synced") {
    console.log(`Google Sheets sync complete: ${result.rows} applications.`);
  } else if (result.status === "disabled") {
    console.error(result.message);
    process.exitCode = 1;
  } else {
    console.error(`Google Sheets sync failed: ${result.message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
