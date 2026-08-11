import { describe, it, expect } from "vitest";
import { isEligibleForPrep, isoDatePlusDays } from "../lib/events/prep";
import type { Booking } from "../lib/sync/types";

const base = (over: Partial<Booking>): Booking =>
  ({
    guest_email: "g@example.com",
    status: "unassigned",
    luma_status: "approved",
    notion_plan: "Free",
    ...over,
  } as Booking);

describe("isEligibleForPrep", () => {
  it("includes approved guests with an email, regardless of assignment", () => {
    expect(isEligibleForPrep(base({ luma_status: "approved", status: "assigned" }))).toBe(true);
    expect(isEligibleForPrep(base({ luma_status: "approved", status: "no_help_needed" }))).toBe(true);
    expect(isEligibleForPrep(base({ luma_status: "approved", status: "unassigned" }))).toBe(true);
  });
  it("excludes non-approved, cancelled, or no email", () => {
    expect(isEligibleForPrep(base({ luma_status: "pending" }))).toBe(false);
    expect(isEligibleForPrep(base({ luma_status: "waitlist" }))).toBe(false);
    expect(isEligibleForPrep(base({ luma_status: "declined" }))).toBe(false);
    expect(isEligibleForPrep(base({ luma_status: "approved", status: "cancelled" }))).toBe(false);
    expect(isEligibleForPrep(base({ luma_status: "approved", guest_email: "" }))).toBe(false);
  });
});

describe("isoDatePlusDays", () => {
  it("adds days in UTC without drift", () => {
    expect(isoDatePlusDays(new Date("2026-08-05T16:00:00Z"), 3)).toBe("2026-08-08");
    expect(isoDatePlusDays(new Date("2026-08-30T16:00:00Z"), 3)).toBe("2026-09-02");
  });
});

describe("isEligibleForPrep — filtered", () => {
  const approved = { luma_status: "approved", notion_plan: "Free", guest_email: "a@x.com", status: "unassigned", filtered: false } as any;
  it("eligible when approved + not filtered", () => {
    expect(isEligibleForPrep(approved)).toBe(true);
  });
  it("excluded when filtered", () => {
    expect(isEligibleForPrep({ ...approved, filtered: true })).toBe(false);
  });
});

describe("isEligibleForPrep — Free plan only", () => {
  const free = { luma_status: "approved", notion_plan: "Free", guest_email: "a@x.com", status: "unassigned", filtered: false } as any;
  it("eligible for approved + Free", () => {
    expect(isEligibleForPrep(free)).toBe(true);
  });
  it("excluded for paid plans and null plan", () => {
    for (const plan of ["Plus", "Business", "Enterprise", null]) {
      expect(isEligibleForPrep({ ...free, notion_plan: plan })).toBe(false);
    }
  });
});

describe("day-before window date", () => {
  it("targets tomorrow (now + 1)", () => {
    const now = new Date("2026-08-25T20:00:00Z");
    expect(isoDatePlusDays(now, 1)).toBe("2026-08-26");
  });
});
