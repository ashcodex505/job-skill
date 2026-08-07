import { describe, expect, it } from "vitest";
import {
  BROWSER_SCAN_MAX_AGE_MS,
  googleCareersSearchUrls,
  googleJobUrlFromJsData,
  isFreshEnough,
  parseRelativePostedAt,
  stripPostedPhrase,
} from "./browser-scrape";

const NOW = new Date("2026-08-04T12:00:00Z");

describe("googleJobUrlFromJsData", () => {
  it("extracts the numeric job id and builds the canonical careers URL", () => {
    // Real shape confirmed live: "Aiqs8c;107900969756304070;$2"
    expect(googleJobUrlFromJsData("Aiqs8c;107900969756304070;$2")).toBe(
      "https://www.google.com/about/careers/applications/jobs/results/107900969756304070",
    );
  });

  it("returns null for a jsdata string with no numeric id segment", () => {
    expect(googleJobUrlFromJsData("")).toBeNull();
    expect(googleJobUrlFromJsData("Aiqs8c;;$2")).toBeNull();
    expect(googleJobUrlFromJsData("not a jsdata string")).toBeNull();
  });
});

describe("googleCareersSearchUrls", () => {
  it("keeps early-career and internship discovery in separate paginated searches", () => {
    const urls = googleCareersSearchUrls().map((value) => new URL(value));
    expect(urls).toHaveLength(9);
    expect(urls.filter((url) => url.searchParams.get("target_level") === "EARLY")).toHaveLength(3);
    expect(urls.filter((url) => url.searchParams.get("target_level") === "INTERN_AND_APPRENTICE")).toHaveLength(3);
    expect(urls.some((url) => url.searchParams.get("q") === '"Software Engineer, Early Career"')).toBe(true);
    expect(urls.some((url) => url.searchParams.get("page") === "3")).toBe(true);
    expect(urls.some((url) => url.searchParams.get("target_level")?.includes(","))).toBe(false);
  });
});

describe("parseRelativePostedAt", () => {
  it("parses hours/days/weeks/months/years ago", () => {
    expect(parseRelativePostedAt("... Posted 3 hours ago", NOW)).toBe(new Date(NOW.getTime() - 3 * 3_600_000).toISOString());
    expect(parseRelativePostedAt("... Posted 21 hours ago", NOW)).toBe(new Date(NOW.getTime() - 21 * 3_600_000).toISOString());
    expect(parseRelativePostedAt("... Posted 2 days ago", NOW)).toBe(new Date(NOW.getTime() - 2 * 86_400_000).toISOString());
    expect(parseRelativePostedAt("... Posted a month ago", NOW)).toBe(new Date(NOW.getTime() - 30 * 86_400_000).toISOString());
    expect(parseRelativePostedAt("... Posted a year ago", NOW)).toBe(new Date(NOW.getTime() - 365 * 86_400_000).toISOString());
  });

  it("parses 'a'/'an' as 1", () => {
    expect(parseRelativePostedAt("Posted a day ago", NOW)).toBe(new Date(NOW.getTime() - 86_400_000).toISOString());
  });

  it("treats 'Posted today' as now", () => {
    expect(parseRelativePostedAt("Posted today", NOW)).toBe(NOW.toISOString());
  });

  it("returns null when there's no posted phrase at all", () => {
    expect(parseRelativePostedAt("Software Engineer Intern - Berlin (2026)", NOW)).toBeNull();
    expect(parseRelativePostedAt("", NOW)).toBeNull();
  });
});

describe("stripPostedPhrase", () => {
  it("strips the posted phrase and everything after it, keeping the location text before it", () => {
    expect(stripPostedPhrase("Software Engineer Intern United States, Washington, Redmond Posted 3 hours ago")).toBe(
      "Software Engineer Intern United States, Washington, Redmond",
    );
  });

  it("is a no-op when there's no posted phrase", () => {
    expect(stripPostedPhrase("Software Engineer Intern - Berlin (2026)")).toBe("Software Engineer Intern - Berlin (2026)");
  });
});

describe("isFreshEnough", () => {
  const now = NOW.getTime();

  it("passes an unknown age through unchanged — can't verify, don't penalize", () => {
    expect(isFreshEnough(null, now)).toBe(true);
  });

  it("passes a known age within the cutoff", () => {
    expect(isFreshEnough(new Date(now - BROWSER_SCAN_MAX_AGE_MS + 1000).toISOString(), now)).toBe(true);
    expect(isFreshEnough(new Date(now).toISOString(), now)).toBe(true);
  });

  it("rejects a known age older than the cutoff", () => {
    expect(isFreshEnough(new Date(now - BROWSER_SCAN_MAX_AGE_MS - 1000).toISOString(), now)).toBe(false);
  });

  it("passes an unparseable postedAt through unchanged, same as unknown", () => {
    expect(isFreshEnough("not a date", now)).toBe(true);
  });
});
