import { describe, expect, it } from "vitest";
import { selectBigTechAlerts } from "./big-tech-alert";
import type { BoardJob } from "./board";

const job = (overrides: Partial<BoardJob>): BoardJob => ({
  dedupeKey: `k:${overrides.company}:${overrides.title}`,
  source: "simplifyjobs",
  company: "Google",
  title: "Software Engineering Intern",
  location: "Mountain View, CA",
  url: "https://example.com/job",
  season: "Fall 2026",
  roleType: "internship",
  score: 90,
  matchedSkills: [],
  postedAt: "2026-07-12",
  firstSeenAt: "2026-07-12T10:00:00.000Z",
  ...overrides,
});

describe("selectBigTechAlerts", () => {
  it("keeps big-tech and unicorn intern/new-grad roles", () => {
    const picked = selectBigTechAlerts([
      job({ company: "Google" }),
      job({ company: "OpenAI", roleType: "new_grad", title: "Software Engineer, New Grad" }),
      job({ company: "Databricks" }),
      job({ company: "Meta Platforms" }), // prefix-matches "Meta"
    ]);
    expect(picked).toHaveLength(4);
  });

  it("excludes quant firms and banks entirely", () => {
    const picked = selectBigTechAlerts([
      job({ company: "Jane Street" }),
      job({ company: "Citadel Securities" }),
      job({ company: "JPMorgan Chase" }),
      job({ company: "American Express" }),
      job({ company: "Capital One" }),
      job({ company: "Goldman Sachs" }),
    ]);
    expect(picked).toHaveLength(0);
  });

  it("excludes trading/quant titles even at allowed companies", () => {
    const picked = selectBigTechAlerts([
      job({ company: "Google", title: "Quantitative Trader Intern" }),
      job({ company: "Uber", title: "Trading Systems Intern" }),
    ]);
    expect(picked).toHaveLength(0);
  });

  it("excludes unknown/non-big-tech companies", () => {
    const picked = selectBigTechAlerts([job({ company: "Bob's Software LLC" }), job({ company: "Acme Startup" })]);
    expect(picked).toHaveLength(0);
  });

  it("excludes non-early-career roles and jobs already alerted by the watchlist", () => {
    const alreadyUrgent = job({ company: "Google" });
    const picked = selectBigTechAlerts(
      [alreadyUrgent, job({ company: "NVIDIA", roleType: "unknown" }), job({ company: "Stripe" })],
      [alreadyUrgent],
    );
    expect(picked.map((j) => j.company)).toEqual(["Stripe"]);
  });

  it("does not match 'Scale AI' against other AI-suffixed companies", () => {
    const picked = selectBigTechAlerts([job({ company: "Fake AI" })]);
    expect(picked).toHaveLength(0);
  });
});

describe("alert ledger", () => {
  it("filters previously alerted postings by canonical URL, whatever the source", async () => {
    const { filterUnalerted, recordAlerted } = await import("./big-tech-alert");
    const a = job({ company: "Google", title: "SWE Intern" });
    const ledger = recordAlerted({}, [a], "2026-07-16T00:00:00.000Z");
    // Same URL with tracking params / different case must still be blocked.
    const again = { ...a, url: a.url.toUpperCase() + "?utm_source=Simplify" };
    expect(filterUnalerted(ledger, [again])).toHaveLength(0);
    expect(filterUnalerted(ledger, [job({ company: "Stripe", url: "https://stripe.com/jobs/2" })])).toHaveLength(1);
  });

  it("prunes ledger entries older than 180 days", async () => {
    const { recordAlerted } = await import("./big-tech-alert");
    const old = { "example.com/ancient": "2025-12-01T00:00:00.000Z" };
    const next = recordAlerted(old, [job({ company: "Google" })], "2026-07-16T00:00:00.000Z");
    expect(Object.keys(next)).toHaveLength(1);
    expect(next["example.com/ancient"]).toBeUndefined();
  });
});
