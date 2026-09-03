import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveNewCalendarEvent, deriveCalendarId } from "@/lib/events/onboard";

afterEach(() => vi.unstubAllGlobals());

describe("deriveCalendarId", () => {
  it("normalizes the first usable part to a slug", () => {
    expect(deriveCalendarId("London", null, null)).toBe("london");
  });
  it("skips a part that normalizes to empty and uses the next usable one", () => {
    // "!!!" is truthy but normalizes to "" — must not win over a real city.
    expect(deriveCalendarId("!!!", "San Francisco", "cal-x")).toBe("san-francisco");
    expect(deriveCalendarId("東京", "Tokyo", null)).toBe("tokyo");
  });
  it("falls back to 'calendar' when nothing is usable (never an empty id)", () => {
    expect(deriveCalendarId("  ", "", null)).toBe("calendar");
  });
});

const page = {
  ok: true,
  json: async () => ({
    entries: [
      { id: "evt-SF", url: "https://luma.com/buildbar-sf-oct", calendar_id: "cal-NA",
        geo_address_json: { city: "San Francisco" } },
    ],
    has_more: false,
  }),
};

describe("resolveNewCalendarEvent", () => {
  it("matches a vanity URL with the pasted key and returns evt/cal/city", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page as Response));
    const r = await resolveNewCalendarEvent({ lumaEvent: "https://luma.com/buildbar-sf-oct", apiKey: "secret-x" });
    expect(r).toEqual({ eventId: "evt-SF", calendarId: "cal-NA", city: "San Francisco", apiKey: "secret-x" });
  });

  it("throws a clear error when the key can't see the event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ entries: [], has_more: false }) } as Response)));
    await expect(
      resolveNewCalendarEvent({ lumaEvent: "https://luma.com/buildbar-sf-oct", apiKey: "wrong" }),
    ).rejects.toThrow(/can't see this event/i);
  });
});
