import { describe, it, expect } from "vitest";
import { isUnmatchedOneOnOne } from "../lib/events/rematch";
import { templateKeyFor, SAMPLE_FIELDS } from "../lib/email/templates";
import type { Booking } from "../lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ guest_email: "g@x.com", requested_slot: "2:00", status: "unassigned", luma_status: "approved", ...over } as Booking);

describe("isUnmatchedOneOnOne", () => {
  it("matches a 1:1 guest with no expert", () => {
    expect(isUnmatchedOneOnOne(bk({}))).toBe(true);
  });
  it("excludes matched, no-request, declined/waitlist, or no email", () => {
    expect(isUnmatchedOneOnOne(bk({ status: "assigned" }))).toBe(false);
    expect(isUnmatchedOneOnOne(bk({ status: "checked_in" }))).toBe(false);
    expect(isUnmatchedOneOnOne(bk({ requested_slot: null }))).toBe(false);
    expect(isUnmatchedOneOnOne(bk({ luma_status: "waitlist" }))).toBe(false);
    expect(isUnmatchedOneOnOne(bk({ luma_status: "declined" }))).toBe(false);
    expect(isUnmatchedOneOnOne(bk({ guest_email: "" }))).toBe(false);
  });
});

describe("template routing", () => {
  it("rematch_pending renders to the guest template; expert_unavailable guest is gone", () => {
    expect(templateKeyFor("rematch_pending", "guest", SAMPLE_FIELDS)).toBe("rematch_pending__guest");
    expect(templateKeyFor("expert_unavailable", "guest", SAMPLE_FIELDS)).toBeNull();
    expect(templateKeyFor("expert_unavailable", "helper", SAMPLE_FIELDS)).toBe("expert_unavailable__helper");
  });
});
