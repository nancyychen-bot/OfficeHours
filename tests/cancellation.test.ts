import { describe, it, expect } from "vitest";
import { shouldSendGuestCancelled } from "../lib/events/cancellation";
import type { Booking } from "../lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ id: "b1", booked_by_email: "expert@x.com", ...over } as Booking);

describe("shouldSendGuestCancelled", () => {
  it("true: declined + an expert was assigned", () => {
    expect(shouldSendGuestCancelled(bk({}), "declined")).toBe(true);
  });
  it("false: declined but no expert (unassigned / coworker)", () => {
    expect(shouldSendGuestCancelled(bk({ booked_by_email: null }), "declined")).toBe(false);
  });
  it("false: not a decline", () => {
    expect(shouldSendGuestCancelled(bk({}), "approved")).toBe(false);
    expect(shouldSendGuestCancelled(bk({}), "waitlist")).toBe(false);
  });
});
