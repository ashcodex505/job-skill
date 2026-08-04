import { describe, expect, it } from "vitest";
import { googleJobUrlFromJsData } from "./browser-scrape";

describe("googleJobUrlFromJsData", () => {
  it("extracts the numeric job id and builds the canonical careers URL", () => {
    // Real shape confirmed live: "Aiqs8c;107900969756304070;$2"
    expect(googleJobUrlFromJsData("Aiqs8c;107900969756304070;$2")).toBe(
      "https://www.google.com/about/careers/applications/jobs/results/107900969756304070",
    );
  });

  it("returns null for a jsdata string with no numeric id segment", () => {
    expect(googleJobUrlFromJsData("")).toBeNull();
    expect(googleJobUrlFromJsData("Aiqs8c;;$2")).toBeNull();
    expect(googleJobUrlFromJsData("not a jsdata string")).toBeNull();
  });
});
