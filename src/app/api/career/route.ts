import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { badRequest, handler, ok } from "@/lib/api";
import { loadCareerConfig, parseCareerConfig } from "@/lib/career/config";
import { claudeAvailable, ClaudeUnavailableError, runClaude } from "@/lib/claude";

const CAREER_DIR = process.env.CAREER_DIR ?? path.join(process.cwd(), "career");

const read = (file: string) => {
  try {
    return fs.readFileSync(path.join(CAREER_DIR, file), "utf8");
  } catch {
    return "";
  }
};

/** Parsed career/*.md personalization, raw file contents, and Claude CLI presence. */
export const GET = handler(async () => {
  return ok({
    ...loadCareerConfig(),
    claudeAvailable: await claudeAvailable(),
    files: { profile: read("profile.md"), preferences: read("preferences.md") },
  });
});

const updateInput = z.object({
  instruction: z.string().trim().min(3).max(4000),
});

/**
 * Plain-English editing of career/profile.md and career/preferences.md via
 * the local Claude Code CLI ("add Rust to my skills", "stop showing crypto
 * companies", "I also want Fall 2027 internships"). Claude returns full
 * updated file contents; we validate they still parse before writing, so a
 * bad response can't brick the scraper config.
 */
export const POST = handler(async (req: Request) => {
  const { instruction } = updateInput.parse(await req.json());

  const profile = read("profile.md");
  const preferences = read("preferences.md");
  const prompt = `You maintain two markdown files that configure a personal job-scraper (career-ops style).
A parser reads ONLY the "- " bullet items under these exact headings:
- profile.md: "## Skills" (also has free-text sections like "## Highlights")
- preferences.md: "## Target roles", "## Seasons", "## Required new grad title keywords", "## Internship seasons", "## Summer 2027 approved companies", "## Preferred locations", "## Positive title keywords", "## Negative title keywords"

Current profile.md:
<<<PROFILE
${profile}
PROFILE>>>

Current preferences.md:
<<<PREFERENCES
${preferences}
PREFERENCES>>>

USER INSTRUCTION: ${instruction}

Apply the instruction. Keep all headings, keep unrelated content unchanged, keep the files concise.
Output ONLY the file(s) you changed, in exactly this format (no commentary, no code fences):
===FILE: profile.md===
<full updated file content>
===END===
===FILE: preferences.md===
<full updated file content>
===END===
If a file needs no changes, omit its block entirely.`;

  let response: string;
  try {
    response = await runClaude(prompt);
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) return badRequest(err.message);
    throw err;
  }

  const blocks = [...response.matchAll(/===FILE: (profile|preferences)\.md===\n([\s\S]*?)\n?===END===/g)];
  if (blocks.length === 0) {
    return badRequest("Claude returned no file updates — try rephrasing the instruction.");
  }

  const updates = new Map<string, string>();
  for (const [, name, content] of blocks) {
    updates.set(`${name}.md`, content.trim() + "\n");
  }

  // Validate the would-be config still parses to something usable.
  const nextProfile = updates.get("profile.md") ?? profile;
  const nextPreferences = updates.get("preferences.md") ?? preferences;
  const nextConfig = parseCareerConfig(nextProfile, nextPreferences);
  const total =
    nextConfig.skills.length + nextConfig.targetRoles.length + nextConfig.seasons.length +
    nextConfig.requiredNewGradTitleKeywords.length + nextConfig.internshipSeasons.length +
    nextConfig.summer2027ApprovedCompanies.length +
    nextConfig.locations.length + nextConfig.positiveKeywords.length + nextConfig.negativeKeywords.length;
  if (total === 0) {
    return badRequest("Update rejected: the edited files would leave the scraper with no usable configuration.");
  }

  fs.mkdirSync(CAREER_DIR, { recursive: true });
  for (const [file, content] of updates) {
    fs.writeFileSync(path.join(CAREER_DIR, file), content);
  }

  return ok({
    ...nextConfig,
    claudeAvailable: true,
    changedFiles: [...updates.keys()],
    files: { profile: read("profile.md"), preferences: read("preferences.md") },
  });
});

export const maxDuration = 300;
