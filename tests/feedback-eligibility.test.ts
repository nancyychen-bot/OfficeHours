import { describe, it, expect } from "vitest";
import {
  isEligibleForFeedback,
  isEligibleForFeedbackReminder,
  FEEDBACK_REMINDER_OFFSET_DAYS,
} from "../lib/events/feedback";
import { isSendDue, scanWindow, SEND_HOUR, shiftDate } from "../lib/events/schedule";
import type { Booking } from "../lib/sync/types";

const base = (over: Partial<Booking>): Booking =>
  ({ guest_email: "g@example.com", notion_email: null, status: "checked_in", ...over } as Booking);

describe("isEligibleForFeedback", () => {
  it("includes checked-in guests with an email", () => {
    expect(isEligibleForFeedback(base({ status: "checked_in" }))).toBe(true);
  });
  it("excludes anyone not checked in, or without an email", () => {
    expect(isEligibleForFeedback(base({ status: "assigned" }))).toBe(false);
    expect(isEligibleForFeedback(base({ status: "no_show" }))).toBe(false);
    expect(isEligibleForFeedback(base({ status: "unassigned" }))).toBe(false);
    expect(isEligibleForFeedback(base({ status: "checked_in", guest_email: "" }))).toBe(false);
  });
});

describe("isEligibleForFeedbackReminder", () => {
  const responded = new Set(["given@example.com", "notion-given@example.com"]);

  it("includes a checked-in guest who has not responded", () => {
    expect(isEligibleForFeedbackReminder(base({ guest_email: "new@example.com" }), responded)).toBe(true);
  });
  it("skips a responder matched by guest_email (case-insensitive)", () => {
    expect(isEligibleForFeedbackReminder(base({ guest_email: "GIVEN@example.com" }), responded)).toBe(false);
  });
  it("skips a responder matched by notion_email", () => {
    const b = base({ guest_email: "booking@example.com", notion_email: "notion-given@example.com" });
    expect(isEligibleForFeedbackReminder(b, responded)).toBe(false);
  });
  it("still requires check-in + email (inherits base eligibility)", () => {
    expect(isEligibleForFeedbackReminder(base({ status: "assigned", guest_email: "new@example.com" }), responded)).toBe(false);
  });
  it("does not skip on an empty notion_email even if the set contains an empty string", () => {
    const b = base({ guest_email: "new@example.com", notion_email: "" });
    expect(isEligibleForFeedbackReminder(b, new Set([""]))).toBe(true);
  });
});

describe("feedback reminder timing (event_date + 2 @ 9am local)", () => {
  const event = { event_date: "2026-08-26", timezone: "America/New_York" };
  const rule = { offsetDays: FEEDBACK_REMINDER_OFFSET_DAYS, targetHour: SEND_HOUR };

  it("fires at 9am local two days after the event", () => {
    // 2026-08-28 13:00Z == 09:00 EDT
    expect(isSendDue(new Date("2026-08-28T13:00:00Z"), event, rule)).toBe(true);
  });
  it("does not fire before 9am local on day+2", () => {
    // 2026-08-28 12:00Z == 08:00 EDT
    expect(isSendDue(new Date("2026-08-28T12:00:00Z"), event, rule)).toBe(false);
  });
  it("does not fire the day after the event (day+1)", () => {
    expect(isSendDue(new Date("2026-08-27T13:00:00Z"), event, rule)).toBe(false);
  });
  it("the fetch window includes a day+2 event (from reaches -3)", () => {
    const { from, to } = scanWindow(new Date("2026-08-28T13:00:00Z"));
    expect(from <= event.event_date && event.event_date <= to).toBe(true);
    expect(from).toBe(shiftDate("2026-08-28", -3));
  });
});
