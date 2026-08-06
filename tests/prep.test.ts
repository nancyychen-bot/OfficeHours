import { describe, it, expect } from "vitest";
import { isEligibleForPrep, isoDatePlusDays } from "../lib/events/prep";
import type { Booking } from "../lib/sync/types";

const base = (over: Partial<Booking>): Booking =>
  ({
    guest_email: "g@example.com",
    status: "unassigned",
    luma_status: "approved",
    ...over,
  } as Booking);

describe("isEligibleForPrep", () => {
  it("includes going guests with an email (pending or approved)", () => {
    expect(isEligibleForPrep(base({ luma_status: "approved" }))).toBe(true);
    expect(isEligibleForPrep(base({ luma_status: "pending" }))).toBe(true);
    expect(isEligibleForPrep(base({ status: "assigned" }))).toBe(true);
    expect(isEligibleForPrep(base({ status: "no_help_needed" }))).toBe(true);
  });
  it("excludes cancelled, declined, waitlisted, or no email", () => {
    expect(isEligibleForPrep(base({ status: "cancelled" }))).toBe(false);
    expect(isEligibleForPrep(base({ luma_status: "declined" }))).toBe(false);
    expect(isEligibleForPrep(base({ luma_status: "waitlist" }))).toBe(false);
    expect(isEligibleForPrep(base({ guest_email: "" }))).toBe(false);
  });
});

describe("isoDatePlusDays", () => {
  it("adds days in UTC without drift", () => {
    expect(isoDatePlusDays(new Date("2026-08-05T16:00:00Z"), 3)).toBe("2026-08-08");
    expect(isoDatePlusDays(new Date("2026-08-30T16:00:00Z"), 3)).toBe("2026-09-02");
  });
});
