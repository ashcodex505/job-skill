import { stripHtml } from "@/lib/career/config";

const PHD = /\b(?:ph\.?\s*d\.?|doctoral|doctorate)\b/i;
const MASTERS = /\bmaster(?:['’]s|s)?\b|\bm\.?\s?sc\.?\b|\bm\.?s\.?\b/i;

/** Degree alternatives win over a PhD mention; a PhD preference isn't a requirement. */
export function acceptsMasters(title: string, description?: string | null): boolean {
  if (MASTERS.test(title)) return true;
  const text = stripHtml(description ?? "");
  // Avoid interpreting MS Office or a team's qualifications as eligibility.
  return text.split(/[\n;]|<\/li>/).some((part) =>
    MASTERS.test(part) && /\b(?:degree|student|enroll|enrolled|enrollment|pursu\w*|education|qualifications|bachelor|ph\.?d)\b/i.test(part),
  );
}

export function roleRestriction(
  title: string,
  description?: string | null,
  knownMastersEligible = false,
): "hardware_role" | "phd_only" | null {
  if (/\bhardware\b/i.test(title)) return "hardware_role";
  if (knownMastersEligible || acceptsMasters(title, description)) return null;
  if (PHD.test(title) && !/\b(?:preferred|optional)\b/i.test(title)) return "phd_only";
  const text = stripHtml((description ?? "").replace(/ph\.\s*d\.?/gi, "PhD"));
  const statements = text.split(/[.!?;\n]/);
  if (statements.some((part) => PHD.test(part)
    && !/\b(?:preferred|optional|not required)\b/i.test(part)
    && /\b(?:required|must|only|pursu\w*|enrolled|enrollment|candidate|candidates)\b/i.test(part))) {
    return "phd_only";
  }
  return null;
}
