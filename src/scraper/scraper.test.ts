import { describe, expect, it } from "vitest";
import { classifyTitle, detectRoleType, detectSeason } from "./classify";
import { dedupeJobs, makeDedupeKey, normalizeJob, type RawJob } from "./normalize";

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

  it("scores Summer 2027 internships above generic postings", () => {
    const target = classifyTitle("Software Engineer Intern (Summer 2027)");
    const generic = classifyTitle("Software Engineer Intern");
    expect(target.score).toBeGreaterThan(generic.score);
  });
});

describe("normalize + dedupe", () => {
  it("normalizes a relevant job with classification fields", () => {
    const job = normalizeJob(raw());
    expect(job).not.toBeNull();
    expect(job!.roleType).toBe("internship");
    expect(job!.season).toBe("Summer 2027");
    expect(job!.dedupeKey).toBe("greenhouse:123");
    expect(job!.score).toBeGreaterThan(0);
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
