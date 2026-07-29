import { describe, expect, it } from "vitest";
import { findScoutCandidates, parseScoutResponse } from "./company-scout";

describe("findScoutCandidates", () => {
  it("excludes companies already covered by any allowlist", () => {
    const candidates = findScoutCandidates(
      ["Google", "Jane Street", "Gemini", "Rivian", "Rivian"], // dup, should collapse
      ["Gemini"], // user's own approved list
      ["Rivian"], // already scouted in a prior pass
    );
    // Google -> static BIG_TECH_COMPANIES; Jane Street -> EXCLUDED_COMPANIES;
    // Gemini -> approvedCompanies param; Rivian -> alreadyScouted param.
    expect(candidates).toEqual([]);
  });

  it("returns genuinely new, deduped candidates", () => {
    const candidates = findScoutCandidates(["Acme Robotics", "Acme Robotics", "Beta Health"], [], []);
    expect(candidates).toEqual(["Acme Robotics", "Beta Health"]);
  });
});

describe("parseScoutResponse", () => {
  const candidates = ["Acme Robotics", "Beta Health", "Gamma Trading"];

  it("keeps only names that were actually offered as candidates", () => {
    // "Gamma Trading" wasn't approved by Claude here, and "Delta Corp" was
    // never offered at all — must never be trusted even if Claude echoes it.
    const result = parseScoutResponse('["Acme Robotics", "Delta Corp"]', candidates);
    expect(result).toEqual(["Acme Robotics"]);
  });

  it("matches case-insensitively but returns the canonical candidate spelling", () => {
    const result = parseScoutResponse('["acme robotics"]', candidates);
    expect(result).toEqual(["Acme Robotics"]);
  });

  it("tolerates surrounding commentary by extracting the JSON array", () => {
    const result = parseScoutResponse('Sure, here you go:\n["Beta Health"]\nHope that helps!', candidates);
    expect(result).toEqual(["Beta Health"]);
  });

  it("returns an empty array for a valid empty response", () => {
    expect(parseScoutResponse("[]", candidates)).toEqual([]);
  });

  it("returns null for malformed JSON", () => {
    expect(parseScoutResponse("not json at all", candidates)).toBeNull();
  });

  it("returns null for well-formed JSON that isn't a string array", () => {
    expect(parseScoutResponse('[{"name": "Acme Robotics"}]', candidates)).toBeNull();
  });

  it("degrades safely (empty, not null) when the extracted bracket span is itself empty", () => {
    // The regex extracts the first "[...]" span it finds — here that's the
    // empty array nested inside an object, not a malformed response. Still
    // safe either way: worst case is "nothing added," never a thrown error.
    expect(parseScoutResponse('{"companies": []}', candidates)).toEqual([]);
  });

  it("dedupes if the same candidate is returned twice", () => {
    const result = parseScoutResponse('["Acme Robotics", "ACME ROBOTICS"]', candidates);
    expect(result).toEqual(["Acme Robotics"]);
  });
});
