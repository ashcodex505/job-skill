import { describe, expect, it } from "vitest";
import { parsePriorityCompanies, serializePriorityCompanies } from "./priority";

describe("parsePriorityCompanies", () => {
  it("reads bullets under the Priority heading", () => {
    const md = `# Priority companies\n\n## Priority\n- Netflix\n- Zscaler\n`;
    expect(parsePriorityCompanies(md)).toEqual(["Netflix", "Zscaler"]);
  });

  it("returns empty for a file with no companies added yet", () => {
    const md = `# Priority companies\n\n## Priority\n`;
    expect(parsePriorityCompanies(md)).toEqual([]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    const md = `## Priority\n- Netflix\n- netflix\n- NETFLIX\n`;
    expect(parsePriorityCompanies(md)).toEqual(["Netflix"]);
  });

  it("ignores bullets outside the Priority section", () => {
    const md = `## Something else\n- Should not appear\n\n## Priority\n- Netflix\n`;
    expect(parsePriorityCompanies(md)).toEqual(["Netflix"]);
  });
});

describe("serializePriorityCompanies", () => {
  it("round-trips through parse", () => {
    const companies = ["Netflix", "Zscaler", "Spotify"];
    expect(parsePriorityCompanies(serializePriorityCompanies(companies))).toEqual(companies);
  });

  it("produces a clean empty-list file that still parses to []", () => {
    expect(parsePriorityCompanies(serializePriorityCompanies([]))).toEqual([]);
  });
});
