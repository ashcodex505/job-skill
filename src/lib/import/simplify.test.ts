import { describe, expect, it } from "vitest";
import { importMatchKey, mapHeaders, mapStatus, parseCsv, parseDate, parseSimplifyCsv } from "./simplify";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas, and newlines in fields", () => {
    const csv = 'a,b,c\n"x, y","he said ""hi""","line1\nline2"';
    expect(parseCsv(csv)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'he said "hi"', "line1\nline2"],
    ]);
  });

  it("handles CRLF and BOM", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops fully empty rows", () => {
    expect(parseCsv("a,b\n,\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("header mapping", () => {
  it("matches Simplify-style headers case/punctuation-insensitively", () => {
    const m = mapHeaders(["Company Name", "Job Title", "Status", "Date Applied", "Job Posting URL", "Location", "Notes"]);
    expect(m).toEqual({ companyName: 0, jobTitle: 1, status: 2, dateApplied: 3, jobUrl: 4, location: 5, notes: 6 });
  });

  it("matches generic tracker headers", () => {
    const m = mapHeaders(["Employer", "Position", "Stage", "Applied On", "Link"]);
    expect(m.companyName).toBe(0);
    expect(m.jobTitle).toBe(1);
    expect(m.status).toBe(2);
    expect(m.dateApplied).toBe(3);
    expect(m.jobUrl).toBe(4);
  });
});

describe("mapStatus", () => {
  it("maps Simplify stages to pipeline statuses", () => {
    expect(mapStatus("Saved")).toBe("interested");
    expect(mapStatus("Bookmarked")).toBe("interested");
    expect(mapStatus("Applied")).toBe("applied");
    expect(mapStatus("Online Assessment")).toBe("oa_received");
    expect(mapStatus("Phone Screen")).toBe("recruiter_screen");
    expect(mapStatus("Interviewing")).toBe("technical_interview");
    expect(mapStatus("Final Round")).toBe("final_round");
    expect(mapStatus("Offer Received")).toBe("offer");
    expect(mapStatus("Rejected")).toBe("rejected");
    expect(mapStatus("Not Interested")).toBe("withdrawn");
    expect(mapStatus(null)).toBe("applied"); // Simplify auto-tracks completed apps
  });
});

describe("parseDate", () => {
  it("accepts ISO, US, and long formats", () => {
    expect(parseDate("2026-07-01")).toBe("2026-07-01");
    expect(parseDate("2026-07-01T12:30:00Z")).toBe("2026-07-01");
    expect(parseDate("7/1/2026")).toBe("2026-07-01");
    expect(parseDate("garbage")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("parseSimplifyCsv", () => {
  const csv = [
    "Company Name,Job Title,Status,Date Applied,Job Posting URL,Location",
    "Stripe,SWE Intern,Applied,2026-06-20,https://stripe.com/jobs/1,SF",
    'Ramp,"Software Engineer, New Grad",Interviewing,6/25/2026,not-a-url,NYC',
    ",missing company,Applied,,,",
  ].join("\n");

  it("parses valid rows and skips incomplete ones", () => {
    const result = parseSimplifyCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toBe(1);
    expect(result.rows[0]).toMatchObject({
      companyName: "Stripe",
      jobTitle: "SWE Intern",
      status: "applied",
      dateApplied: "2026-06-20",
      jobUrl: "https://stripe.com/jobs/1",
    });
    expect(result.rows[1]).toMatchObject({
      companyName: "Ramp",
      jobTitle: "Software Engineer, New Grad",
      status: "technical_interview",
      dateApplied: "2026-06-25",
      jobUrl: null, // invalid URL dropped
    });
  });

  it("reports missing required columns", () => {
    const result = parseSimplifyCsv("Foo,Bar\n1,2");
    expect(result.missingColumns).toEqual(["company", "job title"]);
    expect(result.rows).toHaveLength(0);
  });
});

describe("importMatchKey", () => {
  it("normalizes company/title for dedupe", () => {
    expect(importMatchKey("Stripe", "SWE Intern")).toBe(importMatchKey("stripe ", "swe-intern"));
    expect(importMatchKey("Stripe", "SWE Intern")).not.toBe(importMatchKey("Stripe", "SWE Intern 2"));
  });
});
