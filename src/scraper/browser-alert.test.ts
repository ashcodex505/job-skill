import { describe, expect, it } from "vitest";
import { parseOwnerRepo } from "./browser-alert";

describe("parseOwnerRepo", () => {
  it("parses an https origin URL", () => {
    expect(parseOwnerRepo("https://github.com/ashcodex505/job-skill.git")).toBe("ashcodex505/job-skill");
  });

  it("parses an https origin URL with no .git suffix", () => {
    expect(parseOwnerRepo("https://github.com/ashcodex505/job-skill")).toBe("ashcodex505/job-skill");
  });

  it("parses an ssh origin URL", () => {
    expect(parseOwnerRepo("git@github.com:ashcodex505/job-skill.git")).toBe("ashcodex505/job-skill");
  });

  it("returns null for a non-GitHub remote", () => {
    expect(parseOwnerRepo("https://gitlab.com/someone/somewhere.git")).toBeNull();
  });
});
