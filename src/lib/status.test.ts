import { describe, expect, it } from "vitest";
import { canTransition, isActiveStatus, isTerminalStatus, isValidStatus } from "./status";

describe("status transitions", () => {
  it("validates known statuses", () => {
    expect(isValidStatus("applied")).toBe(true);
    expect(isValidStatus("oa_received")).toBe(true);
    expect(isValidStatus("ghosted")).toBe(false);
  });

  it("allows any real transition but rejects no-ops", () => {
    expect(canTransition("applied", "oa_received")).toBe(true);
    expect(canTransition("final_round", "rejected")).toBe(true);
    expect(canTransition("rejected", "applied")).toBe(true); // revived process
    expect(canTransition("applied", "applied")).toBe(false);
  });

  it("classifies active vs terminal statuses", () => {
    expect(isActiveStatus("technical_interview")).toBe(true);
    expect(isActiveStatus("interested")).toBe(false);
    expect(isTerminalStatus("offer")).toBe(true);
    expect(isTerminalStatus("applied")).toBe(false);
  });
});
