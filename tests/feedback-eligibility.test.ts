import { describe, it, expect } from "vitest";
import { isEligibleForFeedback } from "../lib/events/feedback";
import type { Booking } from "../lib/sync/types";

const base = (over: Partial<Booking>): Booking =>
  ({ guest_email: "g@example.com", status: "checked_in", ...over } as Booking);

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
