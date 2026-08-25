import { describe, it, expect } from "vitest";
import { requireTimezone } from "../lib/events/register";

describe("requireTimezone", () => {
  it("returns the timezone when present", () => {
    expect(requireTimezone("Europe/London", "evt-1")).toBe("Europe/London");
  });
  it("throws when the timezone is missing or blank", () => {
    expect(() => requireTimezone(null, "evt-1")).toThrow(/timezone/i);
    expect(() => requireTimezone(undefined, "evt-1")).toThrow(/timezone/i);
    expect(() => requireTimezone("  ", "evt-1")).toThrow(/timezone/i);
  });
});
