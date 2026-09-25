import { describe, it, expect } from "vitest";
import { classifyCoworkAcceptMiss } from "@/lib/db/bookings";
import type { Booking } from "@/lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ id: "b1", status: "unassigned", luma_status: "pending", filtered: false, ...over } as Booking);

describe("classifyCoworkAcceptMiss", () => {
  it("not_found when the booking is missing", () => {
    expect(classifyCoworkAcceptMiss(null)).toEqual({ status: "rejected", reason: "not_found" });
  });

  it("noop when already cowork_only (idempotent second click)", () => {
    const current = bk({ status: "cowork_only", luma_status: "approved" });
    expect(classifyCoworkAcceptMiss(current)).toEqual({ status: "noop", booking: current });
  });

  it("rejects a filtered candidate", () => {
    const current = bk({ filtered: true });
    expect(classifyCoworkAcceptMiss(current)).toEqual({ status: "rejected", reason: "filtered", current });
  });

  it("rejects an already-claimed (assigned) booking — unclaim first", () => {
    const current = bk({ status: "assigned" });
    expect(classifyCoworkAcceptMiss(current)).toEqual({ status: "rejected", reason: "assigned", current });
  });

  it("rejects a cancelled/declined booking as ineligible", () => {
    const current = bk({ status: "cancelled", luma_status: "declined" });
    expect(classifyCoworkAcceptMiss(current)).toEqual({ status: "rejected", reason: "ineligible", current });
  });
});
