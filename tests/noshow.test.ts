import { describe, it, expect } from "vitest";
import { NO_SHOW_GRACE_MINUTES, noShowCutoffISO } from "@/lib/sync/noshow";

describe("noShowCutoffISO", () => {
  it("subtracts the grace period from now", () => {
    const now = new Date("2026-08-26T22:00:00.000Z");
    expect(noShowCutoffISO(now)).toBe("2026-08-26T21:55:30.000Z");
  });
  it("uses a 4.5-minute default grace (so a :00/:30 slot is caught at the 5-min */5 tick)", () => {
    expect(NO_SHOW_GRACE_MINUTES).toBe(4.5);
  });
});
