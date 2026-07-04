import { handler, ok } from "@/lib/api";
import { loadCareerConfig } from "@/lib/career/config";

/** Parsed career/*.md personalization, for display in Settings. */
export const GET = handler(async () => {
  return ok(loadCareerConfig());
});
