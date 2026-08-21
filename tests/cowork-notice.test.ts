import { describe, it, expect } from "vitest";
import { isCoworkOnlyMismatch } from "../lib/events/cowork-notice";
import type { Booking } from "../lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ id: "b1", status: "no_help_needed", attend_reasons: "I need 1:1 help", ...over } as Booking);

describe("isCoworkOnlyMismatch", () => {
  it("true: no slot + asked for 1:1 help", () => {
    expect(isCoworkOnlyMismatch(bk({}))).toBe(true);
  });
  it("true: reason among several, case-insensitive", () => {
    expect(isCoworkOnlyMismatch(bk({ attend_reasons: "I want to cowork, I NEED 1:1 HELP" }))).toBe(true);
  });
  it("false: booked a slot (unassigned)", () => {
    expect(isCoworkOnlyMismatch(bk({ status: "unassigned" }))).toBe(false);
  });
  it("false: booked + assigned", () => {
    expect(isCoworkOnlyMismatch(bk({ status: "assigned" }))).toBe(false);
  });
  it("false: no-slot coworker who never asked for 1:1", () => {
    expect(isCoworkOnlyMismatch(bk({ attend_reasons: "I want to cowork" }))).toBe(false);
  });
  it("false: empty / null reasons", () => {
    expect(isCoworkOnlyMismatch(bk({ attend_reasons: "" }))).toBe(false);
    expect(isCoworkOnlyMismatch(bk({ attend_reasons: null }))).toBe(false);
  });
});
