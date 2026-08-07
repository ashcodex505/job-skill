import { describe, expect, it } from "vitest";
import {
  clampLocalWatchIntervalMinutes,
  DEFAULT_LOCAL_WATCH_INTERVAL_MINUTES,
  MAX_LOCAL_WATCH_INTERVAL_MINUTES,
  MIN_LOCAL_WATCH_INTERVAL_MINUTES,
} from "./local-watch-settings";

describe("clampLocalWatchIntervalMinutes", () => {
  it("keeps an interval within the supported range", () => {
    expect(clampLocalWatchIntervalMinutes(60)).toBe(60);
    expect(clampLocalWatchIntervalMinutes(120)).toBe(120);
  });

  it("clamps too-frequent and too-slow intervals", () => {
    expect(clampLocalWatchIntervalMinutes(5)).toBe(MIN_LOCAL_WATCH_INTERVAL_MINUTES);
    expect(clampLocalWatchIntervalMinutes(99_999)).toBe(MAX_LOCAL_WATCH_INTERVAL_MINUTES);
  });

  it("rounds finite values and defaults non-finite values", () => {
    expect(clampLocalWatchIntervalMinutes(59.6)).toBe(60);
    expect(clampLocalWatchIntervalMinutes(Number.NaN)).toBe(DEFAULT_LOCAL_WATCH_INTERVAL_MINUTES);
  });
});
