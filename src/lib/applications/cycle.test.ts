import { describe, expect, it } from "vitest";
import { applicationCycleYear, isCurrentCycle } from "./cycle";

const app = (overrides: Partial<Parameters<typeof applicationCycleYear>[0]>) => ({
  jobTitle: "Software Engineer Intern",
  season: null,
  dateApplied: null,
  createdAt: "2026-07-23T00:00:00.000Z",
  ...overrides,
});

describe("applicationCycleYear", () => {
  it("prefers a year mentioned in season over the title", () => {
    expect(applicationCycleYear(app({ season: "Summer 2027", jobTitle: "SWE Intern 2025" }))).toBe(2027);
  });

  it("reads a bare year from the title even without a season word", () => {
    expect(applicationCycleYear(app({ jobTitle: "Software Development Engineer Intern 2025" }))).toBe(2025);
  });

  it("reads Summer/Fall-style years from the title", () => {
    expect(applicationCycleYear(app({ jobTitle: "Software Engineer Intern (Summer 2026)" }))).toBe(2026);
  });

  it("falls back to dateApplied's year when no year appears anywhere in the text", () => {
    expect(applicationCycleYear(app({ jobTitle: "Jr. Software Development Engineer - Detroit", dateApplied: "2024-11-26" }))).toBe(2024);
  });

  it("falls back to createdAt when there is no title year and no dateApplied (fresh 'interested' saves)", () => {
    expect(applicationCycleYear(app({ jobTitle: "Intern, Software Developer", createdAt: "2026-07-23T00:00:00.000Z" }))).toBe(2026);
  });
});

describe("isCurrentCycle", () => {
  it("excludes a stale 2025-cycle import from a 2026 reference year", () => {
    expect(isCurrentCycle(app({ jobTitle: "Amazon Robotics SDE Intern - Summer 2025", dateApplied: "2024-11-27" }), 2026)).toBe(false);
  });

  it("includes a 2026-cycle role from a 2026 reference year", () => {
    expect(isCurrentCycle(app({ jobTitle: "Software Engineer Intern (Summer 2026)", dateApplied: "2025-08-29" }), 2026)).toBe(true);
  });

  it("includes a 2027-cycle role from a 2026 reference year", () => {
    expect(isCurrentCycle(app({ season: "2027 New Grad" }), 2026)).toBe(true);
  });

  it("includes a fresh undated 'interested' save from a 2026 reference year", () => {
    expect(isCurrentCycle(app({ jobTitle: "Intern, Software Developer", createdAt: "2026-07-23T00:00:00.000Z" }), 2026)).toBe(true);
  });
});
