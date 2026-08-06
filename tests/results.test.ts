import { describe, it, expect } from "vitest";
import { computeResults } from "../lib/hub/results";
import type { HubBooking, HubEvent, HubFeedback } from "../lib/hub/queries";

const ev = (luma: string, city: string): HubEvent =>
  ({ id: luma, name: city, city, event_date: "2026-08-10", luma_event_id: luma, status: "planned", slot_count: 0, booking_count: 0 });

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

const fb = (luma: string | null, score: number | null): HubFeedback =>
  ({
    id: Math.random().toString(36).slice(2), guest_name: "G", guest_email: "g@x.com",
    satisfaction_label: null, satisfaction_score: score, confidence: null, interests: [],
    feature_intent: null, highlight: null, notion_expert: null, needs_review: false,
    submitted_at: null, luma_event_id: luma, event_name: null, event_date: null,
  });

describe("computeResults", () => {
  const events = [ev("A", "SF")];

  it("computes the attendance funnel + rate", () => {
    const bookings = [
      bk("A", { status: "checked_in", luma_status: "approved" }),
      bk("A", { status: "no_show", luma_status: "approved" }),
      bk("A", { status: "cancelled", luma_status: "declined" }),
    ];
    const { perEvent } = computeResults(bookings, [], events);
    const r = perEvent[0];
    expect(r.registered).toBe(2); // cancelled excluded
    expect(r.approved).toBe(2);
    expect(r.checkedIn).toBe(1);
    expect(r.noShow).toBe(1);
    expect(r.attendanceRate).toBeCloseTo(0.5);
  });

  it("computes 1:1 coverage", () => {
    const bookings = [
      bk("A", { requested_slot: "2:00", status: "checked_in", booked_by_display_name: "Alex" }), // requested+claimed+completed
      bk("A", { requested_slot: "2:30", status: "assigned", booked_by_display_name: "Bo" }), // requested+claimed
      bk("A", { requested_slot: "3:00", status: "unassigned" }), // requested only
    ];
    const r = computeResults(bookings, [], events).perEvent[0];
    expect(r.oneOnOneRequested).toBe(3);
    expect(r.oneOnOneClaimed).toBe(2);
    expect(r.oneOnOneCompleted).toBe(1);
  });

  it("computes satisfaction response rate + avg", () => {
    const bookings = [bk("A", { status: "checked_in" }), bk("A", { status: "checked_in" })];
    const feedback = [fb("A", 5), fb("A", 3)];
    const r = computeResults(bookings, feedback, events).perEvent[0];
    expect(r.responses).toBe(2);
    expect(r.responseRate).toBeCloseTo(1);
    expect(r.avgSatisfaction).toBeCloseTo(4);
  });

  it("guards divide-by-zero", () => {
    const r = computeResults([], [], events).perEvent[0];
    expect(r.attendanceRate).toBe(0);
    expect(r.responseRate).toBe(0);
    expect(r.avgSatisfaction).toBeNull();
  });

  it("excludes unmatched feedback from per-event but counts it overall", () => {
    const bookings = [bk("A", { status: "checked_in" })];
    const feedback = [fb("A", 4), fb(null, 2)]; // one matched, one unmatched
    const { overall, perEvent } = computeResults(bookings, feedback, events);
    expect(perEvent[0].responses).toBe(1);
    expect(overall.responses).toBe(2);
    expect(overall.avgSatisfaction).toBeCloseTo(3);
  });
});
