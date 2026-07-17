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
    const merged = mergeBoard(prev, [job(), job({ sourceId: "2", dedupeKey: "greenhouse:2", url: "https://stripe.com/jobs/2" })], NOW);
    expect(merged.jobs.find((j) => j.dedupeKey === "greenhouse:1")!.firstSeenAt).toBe("2026-06-01T00:00:00.000Z");
    expect(merged.jobs.find((j) => j.dedupeKey === "greenhouse:2")!.firstSeenAt).toBe(NOW);
  });

  it("moves vanished jobs to the closed list with a closedAt stamp", () => {
    const prev: BoardData = {
      updatedAt: NOW,
      jobs: [{ ...job({ dedupeKey: "greenhouse:gone", title: "Gone Intern", url: "https://stripe.com/jobs/gone" }), firstSeenAt: "2026-06-01T00:00:00.000Z" } as BoardData["jobs"][number]],
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
        { ...job({ company: "OpenAI", dedupeKey: "ashby:9", url: "https://openai.com/jobs/9" }), firstSeenAt: "2026-06-01T00:00:00.000Z" } as BoardData["jobs"][number],
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
    const board = mergeBoard(null, [job(), job({ sourceId: "2", dedupeKey: "greenhouse:2", url: "https://stripe.com/jobs/2" })], NOW);
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

describe("resolvePostedAt / posted-vs-first-seen consistency", () => {
  it("never lets postedAt drift after firstSeenAt across merges", async () => {
    const { resolvePostedAt } = await import("./board");
    // Greenhouse updated_at bumped AFTER we first saw the job.
    expect(resolvePostedAt("2026-06-01T00:00:00.000Z", "2026-07-10T09:00:00.000Z", "2026-06-01T08:00:00.000Z")).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    // Fresh provider date later than first-seen with no previous value: clamp.
    expect(resolvePostedAt(null, "2026-07-10T09:00:00.000Z", "2026-06-01T08:00:00.000Z")).toBe(
      "2026-06-01T08:00:00.000Z",
    );
    // Normal case passes through untouched.
    expect(resolvePostedAt(null, "2026-05-30", "2026-06-01T08:00:00.000Z")).toBe("2026-05-30");
    // Garbage / missing dates.
    expect(resolvePostedAt(null, null, "2026-06-01T08:00:00.000Z")).toBeNull();
    expect(resolvePostedAt("not-a-date", null, "2026-06-01T08:00:00.000Z")).toBeNull();
  });

  it("mergeBoard keeps the earliest posted date for a persisting job", () => {
    const first = mergeBoard(null, [job({ postedAt: "2026-06-01T00:00:00.000Z" })], "2026-06-02T00:00:00.000Z");
    // Next scrape: provider bumped its date forward two weeks.
    const second = mergeBoard(first, [job({ postedAt: "2026-06-15T00:00:00.000Z" })], "2026-06-16T00:00:00.000Z");
    expect(second.jobs[0].postedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(second.jobs[0].firstSeenAt).toBe("2026-06-02T00:00:00.000Z");
    // Invariant the user relies on: posted is never after first seen.
    expect(new Date(second.jobs[0].postedAt!).getTime()).toBeLessThanOrEqual(
      new Date(second.jobs[0].firstSeenAt).getTime(),
    );
  });
});

describe("cross-source board identity (source flip-flop must not re-alert)", () => {
  const NOW2 = "2026-07-16T00:00:00.000Z";
  const workdayCopy = job({
    source: "workday",
    sourceId: "JR1",
    dedupeKey: "workday:JR1",
    url: "https://x.wd5.myworkdayjobs.com/en-US/SiteName/job/Role_JR1",
    postedAt: "2026-07-01",
  });
  const feedCopy = job({
    source: "speedyapply",
    sourceId: null,
    dedupeKey: "speedyapply:sha1:abc",
    url: "https://x.wd5.myworkdayjobs.com/en-US/sitename/job/Role_JR1?utm_source=feed",
    postedAt: "2026-07-02",
  });

  it("a feed-only run does not duplicate a carried adapter row for the same URL", () => {
    // Full run put the workday copy on the board.
    const full = mergeBoard(null, [workdayCopy], "2026-07-10T00:00:00.000Z");
    // Feed-only run: workday's company NOT scanned, only the feed source.
    const feedRun = mergeBoard(full, [feedCopy], NOW2, { companies: [], sources: ["speedyapply"] });
    expect(feedRun.jobs).toHaveLength(1);
    // Same posting: firstSeenAt and the earliest posted date survive the source switch.
    expect(feedRun.jobs[0].firstSeenAt).toBe("2026-07-10T00:00:00.000Z");
    expect(feedRun.jobs[0].postedAt).toBe("2026-07-01");
    expect(feedRun.closed ?? []).toHaveLength(0);
  });

  it("diffNewJobs does not flag a source switch or a close/reopen as new", async () => {
    const { diffNewJobs } = await import("./board");
    const full = mergeBoard(null, [workdayCopy], "2026-07-10T00:00:00.000Z");
    const feedRun = mergeBoard(full, [feedCopy], NOW2, { companies: [], sources: ["speedyapply"] });
    expect(diffNewJobs(full, feedRun)).toHaveLength(0);

    // Close it (full scan, absent), then it reappears from the feed.
    const closedRun = mergeBoard(feedRun, [], "2026-07-16T06:00:00.000Z", { companies: [], sources: ["speedyapply"] });
    expect(closedRun.closed).toHaveLength(1);
    const reopened = mergeBoard(closedRun, [feedCopy], "2026-07-16T12:00:00.000Z", { companies: [], sources: ["speedyapply"] });
    expect(diffNewJobs(closedRun, reopened)).toHaveLength(0);

    // A genuinely new posting IS flagged.
    const fresh = job({ dedupeKey: "greenhouse:999", sourceId: "999", url: "https://boards.greenhouse.io/x/999" });
    const withFresh = mergeBoard(reopened, [feedCopy, fresh], "2026-07-16T13:00:00.000Z");
    expect(diffNewJobs(reopened, withFresh).map((j) => j.dedupeKey)).toEqual(["greenhouse:999"]);
  });
});
