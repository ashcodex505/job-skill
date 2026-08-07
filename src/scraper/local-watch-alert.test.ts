import { describe, expect, it } from "vitest";
import type { BoardJob } from "./board";
import { mergePendingLocalWatchJobs, parseOwnerRepo } from "./local-watch-alert";

function job(key: string, url = `https://example.com/jobs/${key}`): BoardJob {
  return {
    dedupeKey: key,
    source: "greenhouse",
    company: "Example",
    title: "Software Engineer, New Grad",
    location: "United States",
    url,
    season: "2027 New Grad",
    roleType: "new_grad",
    score: 90,
    matchedSkills: [],
    firstSeenAt: "2026-08-07T12:00:00.000Z",
  };
}

describe("local watch GitHub target", () => {
  it("parses HTTPS and SSH GitHub origins", () => {
    expect(parseOwnerRepo("https://github.com/ashcodex505/job-skill.git")).toBe("ashcodex505/job-skill");
    expect(parseOwnerRepo("git@github.com:ashcodex505/job-skill.git")).toBe("ashcodex505/job-skill");
  });
});

describe("mergePendingLocalWatchJobs", () => {
  it("queues only jobs inserted by the current scan", () => {
    const oldJob = job("old");
    const newJob = job("new");
    const state = mergePendingLocalWatchJobs({ initialized: true, alerted: {}, pending: [] }, [oldJob, newJob], ["new"]);
    expect(state.pending).toEqual([newJob]);
  });

  it("keeps a failed notification pending on a later scan", () => {
    const pending = job("retry");
    const state = mergePendingLocalWatchJobs({ initialized: true, alerted: {}, pending: [pending] }, [], []);
    expect(state.pending).toEqual([pending]);
  });

  it("removes a pending job once its canonical URL is in the alert ledger", () => {
    const pending = job("done", "https://example.com/jobs/done?ref=feed");
    const state = mergePendingLocalWatchJobs(
      { initialized: true, alerted: { "example.com/jobs/done": "2026-08-07T12:05:00.000Z" }, pending: [pending] },
      [],
      [],
    );
    expect(state.pending).toEqual([]);
  });
});
