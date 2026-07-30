import { describe, it, expect } from "vitest";
import { NO_SHOW_GRACE_MINUTES, noShowCutoffISO } from "@/lib/sync/noshow";

describe("noShowCutoffISO", () => {
  it("subtracts the grace period from now", () => {
    const now = new Date("2026-08-26T22:00:00.000Z");
    expect(noShowCutoffISO(now)).toBe("2026-08-26T21:45:00.000Z");
  });
  it("uses a 15-minute default grace", () => {
    expect(NO_SHOW_GRACE_MINUTES).toBe(15);
  });
});
