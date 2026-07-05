import { describe, expect, it } from "vitest";
import { classifyTitle, defaultSeasonTargets, detectRoleType, detectSeason } from "./classify";
import { dedupeJobs, makeDedupeKey, normalizeJob, type RawJob } from "./normalize";

/** Deterministic "today" for season-sensitive tests. */
const REF = new Date("2026-07-04T12:00:00Z");

const raw = (overrides: Partial<RawJob> = {}): RawJob => ({
  source: "greenhouse",
  sourceId: "123",
  company: "Stripe",
  title: "Software Engineer Intern (Summer 2027)",
  location: "San Francisco, CA",
  url: "https://stripe.com/jobs/123",
  postedAt: null,
  ...overrides,
});

describe("classify", () => {
  it("detects internships and new grad roles", () => {
    expect(detectRoleType("Software Engineer Intern")).toBe("internship");
    expect(detectRoleType("Software Engineering Co-op")).toBe("internship");
    expect(detectRoleType("Software Engineer, New Grad")).toBe("new_grad");
    expect(detectRoleType("University Graduate Software Engineer")).toBe("new_grad");
    expect(detectRoleType("Senior Software Engineer")).toBe("unknown");
  });

  it("extracts seasons", () => {
    expect(detectSeason("SWE Intern - Summer 2027")).toBe("Summer 2027");
    expect(detectSeason("Software Engineer Co-op (Fall 2026)")).toBe("Fall 2026");
    expect(detectSeason("Software Engineer, New Grad (2027)")).toBe("2027 New Grad");
    expect(detectSeason("Backend Engineer")).toBeNull();
  });

  it("excludes senior/staff/principal/manager roles", () => {
    for (const title of [
      "Senior Software Engineer",
      "Staff Software Engineer, Infrastructure",
      "Principal Engineer",
      "Engineering Manager",
      "Director of Engineering",
    ]) {
      expect(classifyTitle(title).relevant).toBe(false);
    }
  });

  it("keeps early-career roles even with ambiguous wording", () => {
    expect(classifyTitle("Software Engineer Intern, Summer 2027").relevant).toBe(true);
    expect(classifyTitle("New Grad Software Engineer (2027)").relevant).toBe(true);
    expect(classifyTitle("Full-Stack Developer, Early Career").relevant).toBe(true);
  });

  it("rejects non-engineering roles", () => {
    expect(classifyTitle("Account Executive").relevant).toBe(false);
    expect(classifyTitle("Recruiting Coordinator").relevant).toBe(false);
  });

  it("scores next-summer internships above generic postings", () => {
    const target = classifyTitle("Software Engineer Intern (Summer 2027)", null, undefined, REF);
    const generic = classifyTitle("Software Engineer Intern", null, undefined, REF);
    expect(target.score).toBeGreaterThan(generic.score);
  });

  it("regression: totals match the pre-breakdown scoring at the same date", () => {
    // Expected values computed with the original hardcoded-season formula.
    const fixtures: [string, string | null, number][] = [
      ["Software Engineer Intern (Summer 2027)", null, 95], // 40+30+10+15
      ["Software Engineer, New Grad (2027)", null, 90], // 40+30+10+10
      ["Software Engineer Intern", "Remote - US", 75], // 40+30+5
      ["Backend Engineer", null, 40],
      ["2027 New Grad Program", null, 35], // capped: no SWE keyword
    ];
    for (const [title, location, expected] of fixtures) {
      const c = classifyTitle(title, location, undefined, REF);
      expect(c.score, title).toBe(expected);
      const sum = c.breakdown.role + c.breakdown.roleType + c.breakdown.season + c.breakdown.location + c.breakdown.keywords;
      expect(c.score, `${title} (component sum, pre-cap)`).toBeLessThanOrEqual(sum || Infinity);
    }
  });

  it("exposes per-signal score components", () => {
    const c = classifyTitle("Software Engineer Intern (Summer 2027)", "Remote", undefined, REF);
    expect(c.breakdown).toEqual({ role: 40, roleType: 30, season: 25, location: 5, keywords: 0 });
    expect(c.score).toBe(100);
  });
});

describe("defaultSeasonTargets", () => {
  it("targets next summer from May onward, current summer through April", () => {
    expect(defaultSeasonTargets(new Date("2026-07-04T00:00:00Z")).strong).toEqual(["Summer 2027"]);
    expect(defaultSeasonTargets(new Date("2027-02-01T00:00:00Z")).strong).toEqual(["Summer 2027"]);
    expect(defaultSeasonTargets(new Date("2027-06-01T00:00:00Z")).strong).toEqual(["Summer 2028"]);
  });

  it("includes nearby fall/spring terms and both grad years", () => {
    const t = defaultSeasonTargets(new Date("2026-07-04T00:00:00Z"));
    expect(t.medium).toContain("Fall 2026");
    expect(t.medium).toContain("Spring 2027");
    expect(t.medium).toContain("2026 New Grad");
    expect(t.medium).toContain("2027 New Grad");
    expect(defaultSeasonTargets(new Date("2026-10-01T00:00:00Z")).medium).toContain("Fall 2027");
  });
});

describe("normalize + dedupe", () => {
  it("normalizes a relevant job with classification fields", () => {
    const job = normalizeJob(raw(), undefined, REF);
    expect(job).not.toBeNull();
    expect(job!.roleType).toBe("internship");
    expect(job!.season).toBe("Summer 2027");
    expect(job!.dedupeKey).toBe("greenhouse:123");
    expect(job!.score).toBeGreaterThan(0);
    expect(job!.breakdown.skills).toBe(0); // no career config supplied
  });

  it("carries a stripped, length-capped description and skill breakdown", () => {
    const config = {
      skills: ["Python", "React"],
      targetRoles: [], seasons: [], locations: [], positiveKeywords: [], negativeKeywords: [],
    };
    const job = normalizeJob(
      raw({ description: `<p>We use <b>Python</b> daily.</p>${"x".repeat(20_000)}` }),
      config,
      REF,
    )!;
    expect(job.descriptionText).toContain("We use Python daily.");
    expect(job.descriptionText).not.toContain("<b>");
    expect(job.descriptionText!.length).toBeLessThanOrEqual(10_000);
    expect(job.matchedSkills).toEqual(["Python"]);
    expect(job.breakdown.skills).toBe(Math.round((1 / 2) * 25));
    const sum =
      job.breakdown.role + job.breakdown.roleType + job.breakdown.season + job.breakdown.location + job.breakdown.keywords + job.breakdown.skills;
    expect(job.score).toBe(Math.min(100, sum));
  });

  it("drops irrelevant jobs", () => {
    expect(normalizeJob(raw({ title: "Senior Staff Engineer" }))).toBeNull();
    expect(normalizeJob(raw({ title: "" }))).toBeNull();
  });

  it("collapses whitespace in titles", () => {
    expect(normalizeJob(raw({ title: "  Software   Engineer\tIntern " }))!.title).toBe(
      "Software Engineer Intern",
    );
  });

  it("uses provider id for dedupe key, falling back to url hash", () => {
    expect(makeDedupeKey(raw())).toBe("greenhouse:123");
    const noId = makeDedupeKey(raw({ sourceId: null }));
    expect(noId).toMatch(/^greenhouse:sha1:[0-9a-f]{40}$/);
    expect(makeDedupeKey(raw({ sourceId: null }))).toBe(noId); // stable
  });

  it("dedupes identical jobs within a batch, keeping the higher score", () => {
    const a = normalizeJob(raw())!;
    const b = normalizeJob(raw({ location: "Remote" }))!; // same id, better score
    const result = dedupeJobs([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(Math.max(a.score, b.score));
  });

  it("keeps distinct jobs from different sources", () => {
    const a = normalizeJob(raw())!;
    const b = normalizeJob(raw({ source: "lever", sourceId: "xyz", company: "Palantir" }))!;
    expect(dedupeJobs([a, b])).toHaveLength(2);
  });
});
