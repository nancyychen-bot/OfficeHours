import { describe, it, expect } from "vitest";
import { selectBookingsNeedingAssignedComms, assignedCommKey } from "@/lib/events/comms-reconcile";

const NOW = Date.parse("2026-08-18T20:00:00.000Z");
const OLD = "2026-08-18T19:50:00.000Z"; // 10 min ago — past the grace window
const FRESH = "2026-08-18T19:59:30.000Z"; // 30s ago — inside the grace window

function row(over: Partial<Parameters<typeof selectBookingsNeedingAssignedComms>[0][number]> = {}) {
  return {
    id: "b1",
    status: "assigned" as const,
    booked_by_email: "kylie@makenotion.com",
    updated_at: OLD,
    ...over,
  };
}

describe("selectBookingsNeedingAssignedComms", () => {
  it("selects an assigned booking past grace with no assigned-comm ledger row", () => {
    const ids = selectBookingsNeedingAssignedComms([row()], new Set(), NOW);
    expect(ids).toEqual(["b1"]);
  });

  it("skips a booking whose assigned comm was already sent (key present)", () => {
    const sent = new Set([assignedCommKey("b1", "kylie@makenotion.com")]);
    expect(selectBookingsNeedingAssignedComms([row()], sent, NOW)).toEqual([]);
  });

  it("matches the ledger key case-insensitively on email", () => {
    const sent = new Set([assignedCommKey("b1", "Kylie@MakeNotion.com")]);
    expect(selectBookingsNeedingAssignedComms([row()], sent, NOW)).toEqual([]);
  });

  it("skips a freshly-updated booking (a live claim still completing)", () => {
    expect(selectBookingsNeedingAssignedComms([row({ updated_at: FRESH })], new Set(), NOW)).toEqual([]);
  });

  it("skips non-assigned bookings and those without a helper email", () => {
    const rows = [
      row({ id: "u1", status: "unassigned" }),
      row({ id: "c1", status: "cancelled" }),
      row({ id: "n1", booked_by_email: null }),
    ];
    expect(selectBookingsNeedingAssignedComms(rows, new Set(), NOW)).toEqual([]);
  });

  it("selects only the booking missing its comm when others are covered", () => {
    const rows = [row({ id: "b1" }), row({ id: "b2" })];
    const sent = new Set([assignedCommKey("b1", "kylie@makenotion.com")]);
    expect(selectBookingsNeedingAssignedComms(rows, sent, NOW)).toEqual(["b2"]);
  });
});
