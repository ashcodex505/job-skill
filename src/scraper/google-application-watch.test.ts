import { describe, expect, it } from "vitest";
import {
  applyGoogleApplicationProbe,
  canonicalGoogleJobUrl,
  googleApplicationIsOpen,
  googleJobIdFromUrl,
  googleJobTitleFromHtml,
  isGoogleApplicationCheckDue,
  type GoogleApplicationWatchEntry,
} from "./google-application-watch";

const URL = "https://www.google.com/about/careers/applications/jobs/results/78703249065943750";

function entry(): GoogleApplicationWatchEntry {
  return {
    jobId: "78703249065943750",
    url: URL,
    title: "Software Engineer, Early Career, Campus",
    location: "United States",
    status: "waiting_for_apply",
    firstSeenAt: "2026-08-07T00:00:00.000Z",
    lastSeenAt: "2026-08-07T00:00:00.000Z",
    lastCheckedAt: null,
    applyDetectedAt: null,
    notifiedAt: null,
    consecutiveUnavailableChecks: 0,
    consecutiveFailures: 0,
    lastError: null,
    manuallyWatched: false,
    job: {} as GoogleApplicationWatchEntry["job"],
  };
}

describe("Google Careers URL parsing", () => {
  it("accepts slugged URLs and strips tracking parameters", () => {
    const tracked = `${URL}-software-engineer-early-career-campus?fbclid=tracking`;
    expect(googleJobIdFromUrl(tracked)).toBe("78703249065943750");
    expect(canonicalGoogleJobUrl(tracked)).toBe(URL);
  });

  it("rejects search pages and non-Google URLs", () => {
    expect(googleJobIdFromUrl("https://www.google.com/about/careers/applications/jobs/results/?q=swe")).toBeNull();
    expect(googleJobIdFromUrl("https://example.com/jobs/results/78703249065943750")).toBeNull();
  });
});

describe("Google Apply detection", () => {
  it("requires Google's actionable Apply anchor, regardless of attribute order", () => {
    expect(googleApplicationIsOpen('<a class="x" href="./apply?jobId=78703249065943750" aria-label="Apply">Apply</a>')).toBe(true);
    expect(googleApplicationIsOpen('<a aria-label="Apply" href="/about/careers/applications/jobs/results/apply?jobId=1">Apply</a>')).toBe(true);
  });

  it("does not mistake application prose or a disabled-looking button for readiness", () => {
    expect(googleApplicationIsOpen("<p>Learn about applying to Google.</p><button>Apply</button>")).toBe(false);
    expect(googleApplicationIsOpen('<a aria-label="Apply" href="/help/applying">Apply</a>')).toBe(false);
  });

  it("extracts the job title without the Google Careers suffix", () => {
    expect(googleJobTitleFromHtml("<title>Software Engineer, Early Career, Campus — Google Careers</title>")).toBe(
      "Software Engineer, Early Career, Campus",
    );
  });
});

describe("Google application state transitions", () => {
  const checkedAt = "2026-08-07T12:10:00.000Z";

  it("moves waiting to open only on a confirmed Apply marker", () => {
    const next = applyGoogleApplicationProbe(entry(), { kind: "available", applicationOpen: true, title: null }, checkedAt);
    expect(next.status).toBe("application_open");
    expect(next.applyDetectedAt).toBe(checkedAt);
  });

  it("does not make a waiting page due again before ten minutes", () => {
    const watched = { ...entry(), lastCheckedAt: "2026-08-07T12:00:00.000Z" };
    expect(isGoogleApplicationCheckDue(watched, new Date("2026-08-07T12:09:59.999Z").getTime())).toBe(false);
    expect(isGoogleApplicationCheckDue(watched, new Date("2026-08-07T12:10:00.000Z").getTime())).toBe(true);
  });

  it("stops checking once Apply has been detected", () => {
    const watched = { ...entry(), status: "application_open" as const, lastCheckedAt: "2026-08-07T12:00:00.000Z" };
    expect(isGoogleApplicationCheckDue(watched, new Date("2026-08-08T12:00:00.000Z").getTime())).toBe(false);
  });

  it("keeps transient failures retryable without declaring the page unavailable", () => {
    const next = applyGoogleApplicationProbe(entry(), { kind: "error", message: "timeout" }, checkedAt);
    expect(next.status).toBe("waiting_for_apply");
    expect(next.consecutiveFailures).toBe(1);
    expect(next.lastError).toBe("timeout");
  });

  it("requires three confirmed missing-page responses before marking unavailable", () => {
    const probe = { kind: "unavailable" as const, reason: "HTTP 404" };
    const first = applyGoogleApplicationProbe(entry(), probe, checkedAt);
    const second = applyGoogleApplicationProbe(first, probe, checkedAt);
    const third = applyGoogleApplicationProbe(second, probe, checkedAt);
    expect(first.status).toBe("waiting_for_apply");
    expect(second.status).toBe("waiting_for_apply");
    expect(third.status).toBe("unavailable");
  });
});
