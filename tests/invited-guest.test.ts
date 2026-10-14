import { describe, it, expect } from "vitest";
import { isInvitedGuest } from "@/lib/events/invited";
import type { NormalizedRegistration } from "@/lib/luma/parse";

const base: NormalizedRegistration = {
  lumaGuestId: "gst-1", lumaEventId: "evt-1", guestName: "A", guestEmail: "a@x.com",
  guestPhone: null, role: null, company: null, challenge: null, notionEmail: null,
  notionPlan: null, experienceLevel: null, attendReasons: null, requestedSlot: null,
  isCheckedIn: false, approvalStatus: "approved",
};

describe("isInvitedGuest", () => {
  it("is true when the guest answered nothing (host-invited)", () => {
    expect(isInvitedGuest(base)).toBe(true);
  });
  it("is false when any form field is present", () => {
    expect(isInvitedGuest({ ...base, challenge: "Automations" })).toBe(false);
    expect(isInvitedGuest({ ...base, requestedSlot: "2:00-2:30 PM" })).toBe(false);
    expect(isInvitedGuest({ ...base, company: "Acme" })).toBe(false);
    expect(isInvitedGuest({ ...base, experienceLevel: "Beginner" })).toBe(false);
    expect(isInvitedGuest({ ...base, notionPlan: "Free" })).toBe(false);
  });
});
