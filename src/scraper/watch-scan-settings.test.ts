import { describe, expect, it } from "vitest";
import { clampIntervalMinutes, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from "./watch-scan-settings";

describe("clampIntervalMinutes", () => {
  it("passes a value already in range through unchanged", () => {
    expect(clampIntervalMinutes(15)).toBe(15);
  });

  it("clamps below the minimum", () => {
    expect(clampIntervalMinutes(1)).toBe(MIN_INTERVAL_MINUTES);
    expect(clampIntervalMinutes(-5)).toBe(MIN_INTERVAL_MINUTES);
  });

  it("clamps above the maximum", () => {
    expect(clampIntervalMinutes(999999)).toBe(MAX_INTERVAL_MINUTES);
  });

  it("rounds fractional minutes", () => {
    expect(clampIntervalMinutes(12.4)).toBe(12);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampIntervalMinutes(NaN)).toBe(10);
  });

  it("falls back to a supplied fallback instead of the default when given one", () => {
    expect(clampIntervalMinutes(NaN, 45)).toBe(45);
  });
});
