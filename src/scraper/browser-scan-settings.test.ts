import { describe, expect, it } from "vitest";
import { clampIntervalMinutes, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from "./browser-scan-settings";

describe("clampIntervalMinutes", () => {
  it("passes a value already in range through unchanged", () => {
    expect(clampIntervalMinutes(60)).toBe(60);
  });

  it("clamps below the minimum", () => {
    expect(clampIntervalMinutes(1)).toBe(MIN_INTERVAL_MINUTES);
    expect(clampIntervalMinutes(0)).toBe(MIN_INTERVAL_MINUTES);
    expect(clampIntervalMinutes(-30)).toBe(MIN_INTERVAL_MINUTES);
  });

  it("clamps above the maximum", () => {
    expect(clampIntervalMinutes(999999)).toBe(MAX_INTERVAL_MINUTES);
  });

  it("rounds fractional minutes", () => {
    expect(clampIntervalMinutes(45.6)).toBe(46);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampIntervalMinutes(NaN)).toBe(30);
    expect(clampIntervalMinutes(Infinity)).toBe(30);
  });
});
