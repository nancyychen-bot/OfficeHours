import { describe, it, expect } from "vitest";
import { selectDeclinablePendings } from "../lib/events/decline-pending";
import type { Booking } from "../lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ id: "b1", luma_status: "pending", status: "unassigned", ...over } as Booking);

describe("selectDeclinablePendings", () => {
  it("selects only pending bookings", () => {
    const rows = [
      bk({ id: "p1", luma_status: "pending" }),
      bk({ id: "p2", luma_status: "pending", status: "no_help_needed" }),
      bk({ id: "a1", luma_status: "approved" }),
      bk({ id: "w1", luma_status: "waitlist" }),
      bk({ id: "d1", luma_status: "declined" }),
    ];
    expect(selectDeclinablePendings(rows).map((b) => b.id)).toEqual(["p1", "p2"]);
  });

  it("returns empty when nothing is pending", () => {
    expect(selectDeclinablePendings([bk({ luma_status: "approved" })])).toEqual([]);
  });

  it("includes pendings regardless of assignment status (all pendings)", () => {
    const rows = [
      bk({ id: "u1", luma_status: "pending", status: "unassigned" }),
      bk({ id: "n1", luma_status: "pending", status: "no_help_needed" }),
    ];
    expect(selectDeclinablePendings(rows).map((b) => b.id)).toEqual(["u1", "n1"]);
  });
});
