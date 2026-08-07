import { describe, expect, it } from "vitest";
import { alertMarker, createAlertFingerprint, createAlertPayloadEntry } from "./alert-payload";
import type { BoardJob } from "./board";

const job = (url: string): BoardJob => ({
  dedupeKey: url,
  source: "ashby",
  company: "Quora",
  title: "Software Engineer, New Grad",
  location: "Remote - US",
  url,
  season: null,
  roleType: "new_grad",
  score: 85,
  matchedSkills: [],
  firstSeenAt: "2026-08-01T00:00:00Z",
});

describe("transactional alert payloads", () => {
  it("has a stable fingerprint regardless of job order or Ashby URL variant", () => {
    const quora = "https://jobs.ashbyhq.com/quora/452afc2e-0c79-41f8-8201-1aab7df775db";
    const other = "https://example.com/jobs/2";
    expect(createAlertFingerprint("bigtech", [job(quora), job(other)])).toBe(
      createAlertFingerprint("bigtech", [job(other), job(`${quora}/application?embed=true`)]),
    );
  });

  it("embeds the fingerprint used by workflow idempotency checks", () => {
    const entry = createAlertPayloadEntry("urgent", [job("https://example.com/jobs/1")], "2026-08-06T00:00:00Z");
    expect(alertMarker(entry.fingerprint)).toBe(`<!-- job-alert:${entry.fingerprint} -->`);
  });
});
