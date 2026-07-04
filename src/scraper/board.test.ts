import { describe, expect, it } from "vitest";
import { isNewJob, mergeBoard, renderJobsMarkdown, updateReadme, README_END, README_START, type BoardData } from "./board";
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
  matchedSkills: ["Python"],
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

  it("drops jobs that vanished from the scrape (closed postings)", () => {
    const prev: BoardData = {
      updatedAt: NOW,
      jobs: [{ ...job({ dedupeKey: "greenhouse:gone" }), firstSeenAt: NOW } as BoardData["jobs"][number]],
    };
    const merged = mergeBoard(prev, [job()], NOW);
    expect(merged.jobs.map((j) => j.dedupeKey)).toEqual(["greenhouse:1"]);
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
