import { describe, expect, it } from "vitest";
import { buildApplicationSheetRows } from "./google-sheets";

describe("buildApplicationSheetRows", () => {
  it("maps dashboard applications into the Sheet schema", () => {
    const rows = buildApplicationSheetRows(
      [
        {
          companyName: "Stripe",
          jobType: "internship",
          jobTitle: "Software Engineer Intern",
          status: "technical_interview",
          notes: "Recruiter call complete",
          dateApplied: "2026-07-12",
          jobUrl: "https://example.com/job",
          location: "Remote",
          updatedAt: "2026-07-12T20:00:00.000Z",
        },
      ],
      "student@example.com",
    );

    expect(rows[0]).toEqual([
      "Company",
      "Type",
      "Position",
      "Application Email",
      "Status",
      "Notes",
      "Date Applied",
      "Job URL",
      "Location",
      "Last Updated (UTC)",
    ]);
    expect(rows[1]).toEqual([
      "Stripe",
      "Internship",
      "Software Engineer Intern",
      "student@example.com",
      "Technical Interview",
      "Recruiter call complete",
      "2026-07-12",
      "https://example.com/job",
      "Remote",
      "2026-07-12T20:00:00.000Z",
    ]);
  });

  it("keeps a header row when there are no applications", () => {
    expect(buildApplicationSheetRows([], "student@example.com")).toHaveLength(1);
  });
});
