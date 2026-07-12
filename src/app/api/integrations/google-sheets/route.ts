import { handler, ok } from "@/lib/api";
import {
  getGoogleSheetsIntegrationStatus,
  syncApplicationsToGoogleSheetsSafe,
} from "@/lib/integrations/google-sheets";

export const GET = handler(async () => ok(await getGoogleSheetsIntegrationStatus()));

export const POST = handler(async () => ok(await syncApplicationsToGoogleSheetsSafe("manual")));
