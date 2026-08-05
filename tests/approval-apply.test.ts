import { describe, it, expect, vi } from "vitest";
import { applyLumaStatus, type ApplyDeps } from "@/lib/sync/approval";
import type { Booking } from "@/lib/sync/types";

function booking(p: Partial<Booking> = {}): Booking {
  return {
    id: "b1", event_id: "e1", luma_guest_id: "gst-1",
    status: "assigned", luma_status: "pending", requested_slot: "2:00–2:30 PM",
    booked_by_display_name: "Grace", booked_by_type: "employee",
    ...p,
  } as unknown as Booking;
}

function deps(over: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    setLumaStatus: vi.fn(async (_id, next) => ({ ...booking(), luma_status: next })),
    resetAssignment: vi.fn(async (_id, to) => ({ ...booking(), status: to, slot_id: null, booked_by_display_name: null })),
    pushToWorkspaces: vi.fn(async () => {}),
    updateGuestOnLuma: vi.fn(async () => {}),
    sendComms: vi.fn(async () => {}),
    getEventLumaId: vi.fn(async () => "evt-1"),
    log: vi.fn(async () => {}),
    ...over,
  };
}

describe("applyLumaStatus", () => {
  it("Notion-origin approve: writes back to Luma, no downgrade, pushes", async () => {
    const d = deps();
    await applyLumaStatus(booking({ status: "unassigned" }), "approved", { source: "dev" }, d);
    expect(d.setLumaStatus).toHaveBeenCalledWith("b1", "approved");
    expect(d.updateGuestOnLuma).toHaveBeenCalledWith("evt-1", "gst-1", "approved");
    expect(d.resetAssignment).not.toHaveBeenCalled();
    expect(d.sendComms).not.toHaveBeenCalled();
    expect(d.pushToWorkspaces).toHaveBeenCalled();
  });

  it("Notion-origin decline of an assigned booking: releases + emails cancellation", async () => {
    const d = deps();
    await applyLumaStatus(booking({ status: "assigned", requested_slot: "2:00–2:30 PM" }), "declined", { source: "ambassador" }, d);
    expect(d.resetAssignment).toHaveBeenCalledWith("b1", "unassigned");
    expect(d.sendComms).toHaveBeenCalledWith("b1", "cancelled");
    expect(d.updateGuestOnLuma).toHaveBeenCalledWith("evt-1", "gst-1", "declined");
  });

  it("Luma-origin change never writes back to Luma", async () => {
    const d = deps();
    await applyLumaStatus(booking(), "approved", { source: "luma" }, d);
    expect(d.updateGuestOnLuma).not.toHaveBeenCalled();
  });

  it("downgrade with no requested slot resets to no_help_needed", async () => {
    const d = deps();
    await applyLumaStatus(booking({ status: "assigned", requested_slot: null }), "waitlist", { source: "dev" }, d);
    expect(d.resetAssignment).toHaveBeenCalledWith("b1", "no_help_needed");
  });
});
