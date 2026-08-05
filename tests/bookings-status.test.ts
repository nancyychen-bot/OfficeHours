import { describe, it, expect } from "vitest";
import { decideBookingStatusPatch } from "@/lib/db/bookings";

describe("decideBookingStatusPatch", () => {
  it("new going/pending guest with a slot is open for claiming", () => {
    expect(decideBookingStatusPatch(null, "approved", "2:00-2:30 PM")).toEqual({ status: "unassigned" });
    expect(decideBookingStatusPatch(null, "pending", "2:00-2:30 PM")).toEqual({ status: "unassigned" });
  });

  it("new going guest without a slot needs no help", () => {
    expect(decideBookingStatusPatch(null, "approved", null)).toEqual({ status: "no_help_needed" });
  });

  it("declined guest is cancelled and never claimable (slot + helper cleared)", () => {
    expect(decideBookingStatusPatch(null, "declined", "2:00-2:30 PM")).toEqual({
      status: "cancelled",
      slot_id: null,
      booked_by_display_name: null,
      booked_by_type: null,
      booked_by_email: null,
    });
  });

  it("declining an already-claimed booking cancels + releases it", () => {
    expect(decideBookingStatusPatch("assigned", "declined", "2:00-2:30 PM")).toEqual({
      status: "cancelled",
      slot_id: null,
      booked_by_display_name: null,
      booked_by_type: null,
      booked_by_email: null,
    });
  });

  it("is idempotent when already cancelled", () => {
    expect(decideBookingStatusPatch("cancelled", "declined", "2:00-2:30 PM")).toEqual({});
  });

  it("reactivates a previously-cancelled guest who re-registers", () => {
    expect(decideBookingStatusPatch("cancelled", "approved", "2:00-2:30 PM")).toEqual({
      status: "unassigned",
      booked_by_display_name: null,
      booked_by_type: null,
      booked_by_email: null,
    });
  });

  it("never disturbs an active, non-declined booking (no un-claim)", () => {
    expect(decideBookingStatusPatch("assigned", "approved", "2:00-2:30 PM")).toEqual({});
    expect(decideBookingStatusPatch("checked_in", "pending", null)).toEqual({});
  });
});
