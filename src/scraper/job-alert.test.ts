import { describe, expect, it } from "vitest";
import type { BoardJob } from "./board";
import { isRecentlyPosted, renderNewJobsAlertTable } from "./job-alert";

const NOW = "2026-07-12T12:00:00.000Z";
const job = (overrides: Partial<BoardJob> = {}): BoardJob => ({
  dedupeKey: "greenhouse:1",
  source: "greenhouse",
  company: "Stripe",
  title: "Software Engineer, New Grad",
  location: "Remote",
  url: "https://example.com/job/1",
  season: "2027 New Grad",
  roleType: "new_grad",
  score: 90,
  matchedSkills: ["TypeScript"],
  postedAt: "2026-07-12T10:00:00.000Z",
  firstSeenAt: "2026-07-12T11:00:00.000Z",
  ...overrides,
});

describe("renderNewJobsAlertTable", () => {
  it("sorts newest posting first and shows UTC times", () => {
    const markdown = renderNewJobsAlertTable([
      job({ dedupeKey: "old", company: "Older", postedAt: "2026-07-10T09:00:00.000Z" }),
      job({ dedupeKey: "new", company: "Newest", postedAt: "2026-07-12T11:30:00-00:00" }),
    ], NOW);
    expect(markdown.indexOf("Newest")).toBeLessThan(markdown.indexOf("Older"));
    expect(markdown).toContain("2026-07-12 11:30 UTC");
  });

  it("bolds and flags jobs posted within five hours", () => {
    const recent = job({ postedAt: "2026-07-12T07:00:00.000Z" });
    expect(isRecentlyPosted(recent, NOW)).toBe(true);
    const markdown = renderNewJobsAlertTable([recent], NOW);
    expect(markdown).toContain("🚨 **JUST POSTED ≤5h**");
    expect(markdown).toContain("**Stripe**");
    expect(markdown).toContain("**5h ago**");
  });

  it("does not call unknown first-seen time a posting time", () => {
    const markdown = renderNewJobsAlertTable([job({ postedAt: null })], NOW);
    expect(markdown).toContain("Unknown *(first seen 2026-07-12 11:00 UTC)*");
    expect(markdown).not.toContain("JUST POSTED");
  });

  it("does not invent midnight or recent status for date-only sources", () => {
    const dateOnly = job({ postedAt: "2026-07-12" });
    const markdown = renderNewJobsAlertTable([dateOnly], NOW);
    expect(isRecentlyPosted(dateOnly, NOW)).toBe(false);
    expect(markdown).toContain("2026-07-12 *(time unavailable)*");
    expect(markdown).not.toContain("2026-07-12 00:00 UTC");
  });

  it("recognizes Simplify day-precision timestamps normalized to midnight", () => {
    const normalizedDate = job({ source: "simplifyjobs", postedAt: "2026-07-12T00:00:00.000Z" });
    const markdown = renderNewJobsAlertTable([normalizedDate], NOW);
    expect(isRecentlyPosted(normalizedDate, NOW)).toBe(false);
    expect(markdown).toContain("2026-07-12 *(time unavailable)*");
    expect(markdown).not.toContain("2026-07-12 00:00 UTC");
  });
});
