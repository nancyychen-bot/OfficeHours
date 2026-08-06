import { describe, it, expect } from "vitest";
import { isApprovedUnmatched } from "../lib/events/rematch";
import { templateKeyFor, renderComms, SAMPLE_FIELDS } from "../lib/email/templates";
import type { Booking } from "../lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ guest_email: "g@x.com", requested_slot: "2:00", status: "unassigned", luma_status: "approved", previously_matched: false, ...over } as Booking);

describe("isApprovedUnmatched", () => {
  it("matches an approved 1:1 guest with no expert", () => {
    expect(isApprovedUnmatched(bk({}))).toBe(true);
    expect(isApprovedUnmatched(bk({ previously_matched: true }))).toBe(true);
  });
  it("excludes non-approved, matched, no-request, or no email", () => {
    expect(isApprovedUnmatched(bk({ luma_status: "pending" }))).toBe(false);
    expect(isApprovedUnmatched(bk({ luma_status: "waitlist" }))).toBe(false);
    expect(isApprovedUnmatched(bk({ luma_status: "declined" }))).toBe(false);
    expect(isApprovedUnmatched(bk({ status: "assigned" }))).toBe(false);
    expect(isApprovedUnmatched(bk({ status: "checked_in" }))).toBe(false);
    expect(isApprovedUnmatched(bk({ requested_slot: null }))).toBe(false);
    expect(isApprovedUnmatched(bk({ guest_email: "" }))).toBe(false);
  });
});

describe("day-before template routing", () => {
  it("routes the two day-before emails + keeps expert_unavailable helper-only", () => {
    expect(templateKeyFor("rematch_pending", "guest", SAMPLE_FIELDS)).toBe("rematch_pending__guest");
    expect(templateKeyFor("unmatched_notice", "guest", SAMPLE_FIELDS)).toBe("unmatched_notice__guest");
    expect(templateKeyFor("expert_unavailable", "guest", SAMPLE_FIELDS)).toBeNull();
    expect(templateKeyFor("expert_unavailable", "helper", SAMPLE_FIELDS)).toBe("expert_unavailable__helper");
  });
  it("never-matched copy says we couldn't match + offers cowork/calendar", () => {
    const r = renderComms("unmatched_notice", "guest", SAMPLE_FIELDS)!;
    expect(r.text).toContain("weren't able to match you");
    expect(r.text).toContain("cowork");
  });
});
