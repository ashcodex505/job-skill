import { stripHtml } from "@/lib/career/config";
import type { RawJob } from "./normalize";

const ORIGIN = "https://thronescience.com";

/** Parse Throne's server-rendered job cards; fail visibly on layout drift. */
export function parseThroneCareers(html: string): RawJob[] {
  if (!/class=["'][^"']*\bcareers-positions\b[^"']*["']/.test(html)) {
    throw new Error("Throne careers: missing positions section");
  }
  const jobs = new Map<string, RawJob>();
  for (const card of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/class=["'][^"']*\bcareers-position\b[^"']*["']/.test(card[1])) continue;
    const href = card[1].match(/href=["']([^"']+)["']/)?.[1];
    const field = (name: string) => stripHtml(card[2].match(
      new RegExp(`<[^>]+class=["'][^"']*\\bcareers-position__${name}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
    )?.[1] ?? "");
    const title = field("title");
    const location = field("place");
    if (!href || !title || !location) throw new Error("Throne careers: incomplete job card");
    const url = new URL(href, ORIGIN);
    if (url.origin !== ORIGIN || !url.pathname.startsWith("/pages/careers/")) {
      throw new Error("Throne careers: unexpected job URL");
    }
    url.search = "";
    url.hash = "";
    jobs.set(url.href, {
      source: "throne", sourceId: url.pathname, company: "Throne Science",
      title, location, url: url.href, postedAt: null, description: null,
    });
  }
  // Don't silently interpret broken markup as every listing having closed.
  if (!jobs.size && !/no (?:open (?:roles|positions)|current openings)/i.test(stripHtml(html))) {
    throw new Error("Throne careers: no job cards or explicit empty-state message");
  }
  return [...jobs.values()];
}

export function parseThroneDescription(html: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!main || !/<h[12]\b/i.test(main)) throw new Error("Throne careers: missing job detail content");
  return stripHtml(main);
}
