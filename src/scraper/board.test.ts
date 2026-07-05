import { describe, expect, it } from "vitest";
import { closeJobs, isNewJob, mergeBoard, renderJobsMarkdown, updateReadme, README_END, README_START, type BoardData } from "./board";
import type { NormalizedJob } from "./normalize";

const job = (overrides: Partial<NormalizedJob> = {}): NormalizedJob => ({
  source: "greenhouse",
  sourceId: "1",
  company: "Stripe",
  title: "SWE Intern (Summer 2027)",
  location: "SF",
  url: "https://stripe.com/jobs/1",
  postedAt: null,
  dedupeKey: "greenhouse:1",
  roleType: "internship",
  season: "Summer 2027",
  score: 80,
  breakdown: { role: 40, roleType: 30, season: 10, location: 0, keywords: 0, skills: 0 },
  matchedSkills: ["Python"],
  descriptionText: null,
  ...overrides,
});

const NOW = "2026-07-04T12:00:00.000Z";

describe("mergeBoard", () => {
  it("preserves firstSeenAt for jobs seen before", () => {
    const prev: BoardData = {
      updatedAt: "2026-07-01T00:00:00.000Z",
      jobs: [{ ...job(), firstSeenAt: "2026-06-01T00:00:00.000Z" } as BoardData["jobs"][number]],
    };
    const merged = mergeBoard(prev, [job(), job({ sourceId: "2", dedupeKey: "greenhouse:2" })], NOW);
    expect(merged.jobs.find((j) => j.dedupeKey === "greenhouse:1")!.firstSeenAt).toBe("2026-06-01T00:00:00.000Z");
    expect(merged.jobs.find((j) => j.dedupeKey === "greenhouse:2")!.firstSeenAt).toBe(NOW);
  });

  it("moves vanished jobs to the closed list with a closedAt stamp", () => {
    const prev: BoardData = {
      updatedAt: NOW,
      jobs: [{ ...job({ dedupeKey: "greenhouse:gone", title: "Gone Intern" }), firstSeenAt: "2026-06-01T00:00:00.000Z" } as BoardData["jobs"][number]],
    };
    const merged = mergeBoard(prev, [job()], NOW);
    expect(merged.jobs.map((j) => j.dedupeKey)).toEqual(["greenhouse:1"]);
    expect(merged.closed).toHaveLength(1);
    expect(merged.closed![0]).toMatchObject({
      dedupeKey: "greenhouse:gone",
      title: "Gone Intern",
      closedAt: NOW,
      firstSeenAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("reopens a closed job with its original firstSeenAt", () => {
    const prev: BoardData = {
      updatedAt: NOW,
      jobs: [],
      closed: [
        { dedupeKey: "greenhouse:1", company: "Stripe", title: "SWE Intern", season: null, roleType: "internship", firstSeenAt: "2026-06-01T00:00:00.000Z", closedAt: "2026-07-03T00:00:00.000Z" },
      ],
    };
    const merged = mergeBoard(prev, [job()], NOW);
    expect(merged.jobs[0].firstSeenAt).toBe("2026-06-01T00:00:00.000Z");
    expect(merged.closed).toHaveLength(0); // no longer closed
  });

  it("prunes closed entries older than 7 days", () => {
    const prev: BoardData = {
      updatedAt: NOW,
      jobs: [],
      closed: [
        { dedupeKey: "g:old", company: "X", title: "Old", season: null, roleType: "unknown", firstSeenAt: NOW, closedAt: "2026-06-20T00:00:00.000Z" },
        { dedupeKey: "g:recent", company: "X", title: "Recent", season: null, roleType: "unknown", firstSeenAt: NOW, closedAt: "2026-07-01T00:00:00.000Z" },
      ],
    };
    const merged = mergeBoard(prev, [], NOW);
    expect(merged.closed!.map((c) => c.dedupeKey)).toEqual(["g:recent"]);
  });

  it("carries forward jobs from companies not scanned this run instead of closing them", () => {
    const prev: BoardData = {
      updatedAt: NOW,
      jobs: [
        { ...job({ company: "OpenAI", dedupeKey: "ashby:9" }), firstSeenAt: "2026-06-01T00:00:00.000Z" } as BoardData["jobs"][number],
      ],
    };
    const merged = mergeBoard(prev, [job()], NOW, ["Stripe"]); // OpenAI not scanned
    expect(merged.jobs.map((j) => j.dedupeKey).sort()).toEqual(["ashby:9", "greenhouse:1"]);
    expect(merged.closed).toHaveLength(0);

    // Same scrape but with OpenAI scanned → its missing job closes.
    const merged2 = mergeBoard(prev, [job()], NOW, ["Stripe", "OpenAI"]);
    expect(merged2.jobs.map((j) => j.dedupeKey)).toEqual(["greenhouse:1"]);
    expect(merged2.closed!.map((c) => c.dedupeKey)).toEqual(["ashby:9"]);
  });
});

describe("mergeBoard feed-source semantics", () => {
  it("feed jobs close only when the feed was scanned, never via company scans", () => {
    const feedJob = { ...job({ dedupeKey: "simplifyjobs:u1", source: "simplifyjobs", company: "Stripe" }), firstSeenAt: NOW } as BoardData["jobs"][number];
    const prev: BoardData = { updatedAt: NOW, jobs: [feedJob] };

    // Stripe scanned but feed NOT scanned → carried forward.
    const a = mergeBoard(prev, [], NOW, { companies: ["Stripe"], sources: [] });
    expect(a.jobs.map((j) => j.dedupeKey)).toEqual(["simplifyjobs:u1"]);
    expect(a.closed).toHaveLength(0);

    // Feed scanned and listing gone → closed.
    const b = mergeBoard(prev, [], NOW, { companies: [], sources: ["simplifyjobs"] });
    expect(b.jobs).toHaveLength(0);
    expect(b.closed!.map((c) => c.dedupeKey)).toEqual(["simplifyjobs:u1"]);
  });
});

describe("closeJobs", () => {
  it("moves the named jobs to closed (dead links)", () => {
    const board = mergeBoard(null, [job(), job({ sourceId: "2", dedupeKey: "greenhouse:2" })], NOW);
    const result = closeJobs(board, new Set(["greenhouse:2"]), NOW);
    expect(result.jobs.map((j) => j.dedupeKey)).toEqual(["greenhouse:1"]);
    expect(result.closed!.map((c) => c.dedupeKey)).toEqual(["greenhouse:2"]);
  });
});

describe("isNewJob", () => {
  it("flags jobs first seen within ~one cycle", () => {
    const board = mergeBoard(null, [job()], NOW);
    expect(isNewJob(board.jobs[0], NOW)).toBe(true);
    expect(isNewJob({ ...board.jobs[0], firstSeenAt: "2026-07-01T00:00:00.000Z" }, NOW)).toBe(false);
  });
});

describe("renderJobsMarkdown", () => {
  it("renders the recently-closed section without apply links", () => {
    const prev: BoardData = {
      updatedAt: NOW,
      jobs: [{ ...job({ dedupeKey: "g:gone", title: "Closed Intern Role", url: "https://x.test/closed" }), firstSeenAt: NOW } as BoardData["jobs"][number]],
    };
    const md = renderJobsMarkdown(mergeBoard(prev, [job()], NOW));
    expect(md).toContain("## 🚪 Recently closed (last 7 days) (1)");
    expect(md).toContain("Closed Intern Role");
    expect(md).not.toContain("https://x.test/closed"); // no apply link for closed roles
  });

  it("renders sections with apply links and escapes pipes", () => {
    const board = mergeBoard(null, [job({ title: "SWE Intern | Payments" }), job({ sourceId: "3", dedupeKey: "g:3", roleType: "new_grad", title: "New Grad SWE" })], NOW);
    const md = renderJobsMarkdown(board);
    expect(md).toContain("## 🛠️ Internships (1)");
    expect(md).toContain("## 🎓 New Grad (1)");
    expect(md).toContain("[**Apply ➜**](https://stripe.com/jobs/1)");
    expect(md).toContain("SWE Intern \\| Payments");
    expect(md).toContain("80% (1 skills)");
  });
});

describe("updateReadme", () => {
  it("appends the section when markers are absent, replaces when present", () => {
    const board = mergeBoard(null, [job()], NOW);
    const v1 = updateReadme("# My Project\n\ndocs here\n", board);
    expect(v1).toContain(README_START);
    expect(v1).toContain("docs here");

    const board2 = mergeBoard(null, [job({ title: "Different Role Title SWE Intern" })], NOW);
    const v2 = updateReadme(v1, board2);
    expect(v2).toContain("Different Role Title SWE Intern");
    expect(v2).not.toContain("SWE Intern (Summer 2027)");
    expect(v2.split(README_END)).toHaveLength(2); // exactly one section
  });
});
