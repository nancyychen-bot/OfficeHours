import { describe, it, expect } from "vitest";
import { renderComms, templateKeyFor, SAMPLE_FIELDS } from "../lib/email/templates";
import { slotMoveCommsPlan } from "../lib/events/slot-change";

describe("slotMoveCommsPlan (organizer moves a booking's slot in Notion)", () => {
  it("re-invites (keeps the expert) when the booking is already assigned", () => {
    expect(slotMoveCommsPlan("assigned")).toEqual({ reinvite: true, notifyGuest: false });
  });
  it("notifies the guest when they registered but have no expert yet", () => {
    expect(slotMoveCommsPlan("unassigned")).toEqual({ reinvite: false, notifyGuest: true });
  });
  it("does nothing for statuses that shouldn't get a 1:1 time-change email", () => {
    for (const s of ["cancelled", "no_show", "cowork_only", "no_help_needed", "checked_in"] as const) {
      expect(slotMoveCommsPlan(s)).toEqual({ reinvite: false, notifyGuest: false });
    }
  });
});

describe("slot_changed emails", () => {
  it("routes guest + helper variants", () => {
    expect(templateKeyFor("slot_changed", "guest", SAMPLE_FIELDS)).toBe("slot_changed__guest");
    expect(templateKeyFor("slot_changed", "helper", SAMPLE_FIELDS)).toBe("slot_changed__helper");
  });
  it("guest email names the new slot + promises a rematch", () => {
    const r = renderComms("slot_changed", "guest", { ...SAMPLE_FIELDS, slotName: "3:00–3:30 PM" })!;
    expect(r.subject).toContain("3:00–3:30 PM");
    expect(r.text).toContain("match you with a Notion expert");
  });
  it("helper email says removed + calendar cancelled", () => {
    const r = renderComms("slot_changed", "helper", SAMPLE_FIELDS)!;
    expect(r.text).toContain("you've been removed");
    expect(r.text).toContain("cancelled");
  });
});
