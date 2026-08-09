import { describe, expect, it } from "vitest";
import type { BoardJob } from "./board";
import {
  dedupeLocalWatchJobs,
  isLocalWatchRecentEnough,
  localWatchSemanticKey,
  mergePendingLocalWatchJobs,
  parseOwnerRepo,
} from "./local-watch-alert";

const NOW = "2026-08-08T12:00:00.000Z";

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
    postedAt: "2026-08-08T10:00:00.000Z",
    firstSeenAt: "2026-08-07T12:00:00.000Z",
  };
}

const state = () => ({ initialized: true, alerted: {}, semanticAlerted: {}, pending: [] as BoardJob[] });

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
    const next = mergePendingLocalWatchJobs(state(), [oldJob, newJob], ["new"], NOW);
    expect(next.pending).toEqual([newJob]);
  });

  it("keeps a failed notification pending on a later scan", () => {
    const pending = job("retry");
    const next = mergePendingLocalWatchJobs({ ...state(), pending: [pending] }, [], [], NOW);
    expect(next.pending).toEqual([pending]);
  });

  it("removes a pending job once its canonical URL is in the alert ledger", () => {
    const pending = job("done", "https://example.com/jobs/done?ref=feed");
    const next = mergePendingLocalWatchJobs(
      { ...state(), alerted: { "example.com/jobs/done": "2026-08-07T12:05:00.000Z" }, pending: [pending] },
      [],
      [],
      NOW,
    );
    expect(next.pending).toEqual([]);
  });

  it("also suppresses URLs already notified by CI's shared big-tech ledger", () => {
    const pending = job("shared");
    const next = mergePendingLocalWatchJobs(
      { ...state(), pending: [pending] },
      [],
      [],
      NOW,
      { "example.com/jobs/shared": "2026-08-08T11:00:00.000Z" },
    );
    expect(next.pending).toEqual([]);
  });

  it("suppresses a provider-URL variant after the same semantic role was alerted", () => {
    const pending = job("second-url", "https://different.example/jobs/456");
    const next = mergePendingLocalWatchJobs(
      { ...state(), semanticAlerted: { [localWatchSemanticKey(pending)]: "2026-08-08T11:00:00.000Z" }, pending: [pending] },
      [],
      [],
      NOW,
    );
    expect(next.pending).toEqual([]);
  });
});

describe("local-watch two-day freshness", () => {
  const nowMs = new Date(NOW).getTime();

  it("accepts precise timestamps up to exactly 48 hours and rejects anything older", () => {
    expect(isLocalWatchRecentEnough({ ...job("exact"), postedAt: "2026-08-06T12:00:00.000Z" }, nowMs)).toBe(true);
    expect(isLocalWatchRecentEnough({ ...job("old"), postedAt: "2026-08-06T11:59:59.999Z" }, nowMs)).toBe(false);
  });

  it("treats date-only postings by calendar day", () => {
    expect(isLocalWatchRecentEnough({ ...job("two-days"), postedAt: "2026-08-06" }, nowMs)).toBe(true);
    expect(isLocalWatchRecentEnough({ ...job("three-days"), postedAt: "2026-08-05" }, nowMs)).toBe(false);
  });

  it("does not alert when the source supplies no posting date", () => {
    expect(isLocalWatchRecentEnough({ ...job("unknown"), postedAt: null }, nowMs)).toBe(false);
  });
});

describe("local-watch duplicate collapse", () => {
  it("collapses canonical URL variants", () => {
    const first = job("feed", "https://example.com/jobs/1?utm_source=feed");
    const second = { ...job("adapter", "https://example.com/jobs/1"), source: "lever" as const };
    expect(dedupeLocalWatchJobs([first, second])).toHaveLength(1);
  });

  it("collapses the same company/title/location/season under different URLs", () => {
    const first = job("req-1", "https://example.com/jobs/1");
    const second = job("req-2", "https://example.com/jobs/2");
    expect(dedupeLocalWatchJobs([first, second])).toHaveLength(1);
  });

  it("keeps otherwise-similar roles in different seasons", () => {
    const first = job("fall", "https://example.com/jobs/1");
    const second = { ...job("spring", "https://example.com/jobs/2"), season: "Spring 2027" };
    expect(dedupeLocalWatchJobs([first, second])).toHaveLength(2);
  });
});
