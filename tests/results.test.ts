import { describe, it, expect } from "vitest";
import { computeResults, computeCommunity } from "../lib/hub/results";
import type { HubBooking, HubEvent, HubFeedback, LumaStats } from "../lib/hub/queries";

const ev = (luma: string, city: string, luma_stats: LumaStats | null = null): HubEvent =>
  ({ id: luma, name: city, city, event_date: "2026-08-10", luma_event_id: luma, status: "planned", slot_count: 0, booking_count: 0, luma_stats, luma_synced_at: null });

const bk = (luma: string, over: Partial<HubBooking>): HubBooking =>
  ({
    id: Math.random().toString(36).slice(2),
    guest_name: "G", guest_email: "g@x.com", company: null, challenge: null,
    status: "unassigned", luma_status: "approved", booked_by_display_name: null,
    booked_by_type: null, booked_by_email: null, location: "SF", event_name: "e",
    event_date: "2026-08-10", luma_event_id: luma, slot_name: null, slot_starts_at: null,
    requested_slot: null, role: null, guest_phone: null, notion_email: null,
    notion_plan: null, experience_level: null, attend_reasons: null, ...over,
  });

const fb = (luma: string | null, over: Partial<HubFeedback> = {}): HubFeedback =>
  ({
    id: Math.random().toString(36).slice(2), guest_name: "G", guest_email: "g@x.com",
    satisfaction_label: null, satisfaction_score: null, confidence: null, interests: [],
    feature_intent: null, highlight: null, notion_expert: null, needs_review: false,
    submitted_at: null, luma_event_id: luma, event_name: null, event_date: null, ...over,
  });

describe("computeResults attendance", () => {
  it("uses booking-derived counts when no luma_stats", () => {
    const bookings = [bk("A", { status: "checked_in" }), bk("A", { status: "no_show" })];
    const r = computeResults(bookings, [], [ev("A", "SF")]).perEvent[0];
    expect(r.attendanceSource).toBe("mirror");
    expect(r.checkedIn).toBe(1);
    expect(r.noShow).toBe(1);
    expect(r.attendanceRate).toBeCloseTo(0.5); // 1 checked-in / 2 approved
  });

  it("prefers luma_stats when present (no-show still from bookings)", () => {
    const stats: LumaStats = { registered: 40, approved: 30, checkedIn: 24, waitlist: 5, pending: 0, capacity: null };
    const bookings = [bk("A", { status: "no_show" })];
    const r = computeResults(bookings, [], [ev("A", "SF", stats)]).perEvent[0];
    expect(r.attendanceSource).toBe("luma");
    expect(r.registered).toBe(40);
    expect(r.checkedIn).toBe(24);
    expect(r.waitlist).toBe(5);
    expect(r.noShow).toBe(1);
    expect(r.attendanceRate).toBeCloseTo(24 / 30);
  });
});

describe("computeResults 1:1 + satisfaction + confidence + interests", () => {
  const events = [ev("A", "SF")];
  it("1:1 unmet = requested - claimed", () => {
    const bookings = [
      bk("A", { requested_slot: "2", status: "checked_in", booked_by_display_name: "X" }),
      bk("A", { requested_slot: "3", status: "unassigned" }),
    ];
    const r = computeResults(bookings, [], events).perEvent[0];
    expect(r.oneOnOneRequested).toBe(2);
    expect(r.oneOnOneClaimed).toBe(1);
    expect(r.oneOnOneUnmet).toBe(1);
  });

  it("satisfaction distribution + avg", () => {
    const feedback = [fb("A", { satisfaction_score: 5 }), fb("A", { satisfaction_score: 5 }), fb("A", { satisfaction_score: 3 })];
    const r = computeResults([bk("A", { status: "checked_in" })], feedback, events).perEvent[0];
    expect(r.satisfactionDist[5]).toBe(2);
    expect(r.satisfactionDist[3]).toBe(1);
    expect(r.avgSatisfaction).toBeCloseTo(13 / 3);
  });

  it("confidence % more confident, ignoring unknown", () => {
    const feedback = [
      fb("A", { confidence: "Much more" }),
      fb("A", { confidence: "Somewhat more" }),
      fb("A", { confidence: "Same" }),
      fb("A", { confidence: null }),
    ];
    const r = computeResults([], feedback, events).perEvent[0];
    expect(r.confidence.muchMore).toBe(1);
    expect(r.pctMoreConfident).toBeCloseTo(2 / 3); // 2 of 3 answered
  });

  it("interests tally sorted desc", () => {
    const feedback = [
      fb("A", { interests: ["Joining a beta", "Creating a template"] }),
      fb("A", { interests: ["Joining a beta"] }),
    ];
    const r = computeResults([], feedback, events).perEvent[0];
    expect(r.interests[0]).toEqual({ label: "Joining a beta", count: 2 });
  });
});

describe("computeCommunity repeat attendance", () => {
  it("counts a guest at 2 events as repeat, by email", () => {
    const bookings = [
      bk("A", { status: "checked_in", guest_email: "a@x.com", guest_name: "Ann" }),
      bk("B", { status: "checked_in", guest_email: "A@x.com", guest_name: "Ann" }), // same email, diff case
      bk("A", { status: "checked_in", guest_email: "b@x.com", guest_name: "Bo" }),
    ];
    const c = computeCommunity(bookings);
    expect(c.uniqueAttendees).toBe(2);
    expect(c.repeatAttendees).toBe(1);
    expect(c.repeatRate).toBeCloseTo(0.5);
    expect(c.top[0]).toEqual({ email: "a@x.com", name: "Ann", events: 2 });
  });
  it("ignores non-checked-in bookings", () => {
    const c = computeCommunity([bk("A", { status: "no_show", guest_email: "a@x.com" })]);
    expect(c.uniqueAttendees).toBe(0);
  });
});
