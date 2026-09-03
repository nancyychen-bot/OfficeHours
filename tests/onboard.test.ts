import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveNewCalendarEvent } from "@/lib/events/onboard";

afterEach(() => vi.unstubAllGlobals());

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
