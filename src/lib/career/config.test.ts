import { describe, expect, it } from "vitest";
import { parseCareerConfig, parseSection, skillMatch, stripHtml } from "./config";

const PREFS = `# Prefs
intro prose

## Target roles
- Software Engineer
- Backend

## Seasons

- Summer 2027
- Fall 2026
- 2027 New Grad

## Required new grad title keywords
- New Grad
- Early Career

## Internship seasons
- Fall 2026
- Summer 2027

## Summer 2027 approved companies
- Stripe
- Google

## Preferred locations
- Remote
- Arizona

## Positive title keywords
- Co-op

## Negative title keywords
- Blockchain
- Web3
`;

const PROFILE = `# Me
## Skills
- Python
- C++
- Java
- React
some prose that is not a bullet
## Highlights
- built stuff
`;

describe("parseSection", () => {
  it("reads bullets under the heading only", () => {
    expect(parseSection(PREFS, "Target roles")).toEqual(["Software Engineer", "Backend"]);
    expect(parseSection(PREFS, "Seasons")).toEqual(["Summer 2027", "Fall 2026", "2027 New Grad"]);
    expect(parseSection(PROFILE, "Skills")).toEqual(["Python", "C++", "Java", "React"]);
  });

  it("is case-insensitive on headings and returns [] when missing", () => {
    expect(parseSection(PREFS, "TARGET ROLES")).toHaveLength(2);
    expect(parseSection(PREFS, "Nonexistent")).toEqual([]);
  });
});

describe("parseCareerConfig", () => {
  it("builds the full config", () => {
    const cfg = parseCareerConfig(PROFILE, PREFS);
    expect(cfg.skills).toContain("Python");
    expect(cfg.negativeKeywords).toEqual(["Blockchain", "Web3"]);
    expect(cfg.locations).toContain("Remote");
    expect(cfg.positiveKeywords).toEqual(["Co-op"]);
    expect(cfg.requiredNewGradTitleKeywords).toEqual(["New Grad", "Early Career"]);
    expect(cfg.internshipSeasons).toEqual(["Fall 2026", "Summer 2027"]);
    expect(cfg.summer2027ApprovedCompanies).toEqual(["Stripe", "Google"]);
  });
});

describe("skillMatch", () => {
  it("matches word-boundary skills and symbol skills", () => {
    const { matched, ratio } = skillMatch(["Python", "C++", "Java", "React"], "We use Python and C++ daily. JavaScript a plus.");
    expect(matched).toEqual(["Python", "C++"]); // "Java" must NOT match "JavaScript"
    expect(ratio).toBeCloseTo(0.5);
  });

  it("handles empty inputs", () => {
    expect(skillMatch([], "text").ratio).toBe(0);
    expect(skillMatch(["Python"], "").ratio).toBe(0);
  });
});

describe("stripHtml", () => {
  it("removes tags and entities", () => {
    expect(stripHtml("<p>Hello&nbsp;<b>world</b> &amp; team</p>")).toBe("Hello world & team");
  });
});
