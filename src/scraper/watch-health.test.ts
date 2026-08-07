import { describe, expect, it } from "vitest";
import { detectRecoveryGap } from "./watch-health";

describe("priority watcher recovery", () => {
  it("reports a prolonged gap after the first successful recovery scan", () => {
    const gap = detectRecoveryGap(
      { lastSuccessfulPriorityScanAt: "2026-08-06T14:59:00Z" },
      "2026-08-07T00:05:00Z",
    );
    expect(gap?.gapMinutes).toBe(546);
    expect(gap?.fingerprint).toMatch(/^[0-9a-f]{24}$/);
  });

  it("does not make normal schedule jitter noisy", () => {
    expect(
      detectRecoveryGap({ lastSuccessfulPriorityScanAt: "2026-08-06T14:59:00Z" }, "2026-08-06T15:37:00Z"),
    ).toBeNull();
  });
});
