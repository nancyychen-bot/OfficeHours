import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveNewCalendarEvent, deriveCalendarId, connectCalendar } from "@/lib/events/onboard";
import * as client from "@/lib/luma/client";
import * as db from "@/lib/db/luma-calendars";
import * as cal from "@/lib/luma/calendars";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("connectCalendar (standalone, no event)", () => {
  it("validates the key, derives the cal- id from the calendar URL, and upserts", async () => {
    vi.spyOn(client, "listUpcomingCalendarEvents").mockResolvedValue([]); // valid key, no upcoming events
    vi.spyOn(db, "getLumaCalendarByCalendarId").mockResolvedValue(null);
    const upsert = vi.spyOn(db, "upsertLumaCalendar").mockResolvedValue();
    vi.spyOn(cal, "__bustCalendarCache").mockImplementation(() => {});

    const r = await connectCalendar({
      slug: "Korea", apiKey: "secret-x", webhookSecret: "whsec-y",
      calendarUrl: "https://luma.com/calendar/cal-Md9x0T9gv5euc9v",
    });

    expect(r).toEqual({ id: "korea", calendarId: "cal-Md9x0T9gv5euc9v", city: null });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "korea", apiKey: "secret-x", webhookSecret: "whsec-y", calendarId: "cal-Md9x0T9gv5euc9v", calendarUrl: "https://luma.com/calendar/cal-Md9x0T9gv5euc9v" }),
    );
  });

  it("falls back to the first upcoming event's cal- id and city when the URL has none", async () => {
    vi.spyOn(client, "listUpcomingCalendarEvents").mockResolvedValue([
      { id: "evt-1", url: "https://luma.com/x", calendarId: "cal-FROMEVENT", city: "Seoul" },
    ]);
    vi.spyOn(db, "getLumaCalendarByCalendarId").mockResolvedValue(null);
    vi.spyOn(db, "upsertLumaCalendar").mockResolvedValue();
    vi.spyOn(cal, "__bustCalendarCache").mockImplementation(() => {});

    const r = await connectCalendar({ slug: "korea", apiKey: "secret-x", webhookSecret: "w", calendarUrl: "https://luma.com/notion-korea" });
    expect(r).toEqual({ id: "korea", calendarId: "cal-FROMEVENT", city: "Seoul" });
  });

  it("rejects an invalid key (Luma rejects the list call)", async () => {
    vi.spyOn(client, "listUpcomingCalendarEvents").mockRejectedValue(new Error("Luma calendars/events/list failed: HTTP 401"));
    await expect(
      connectCalendar({ slug: "x", apiKey: "bad", webhookSecret: "w", calendarUrl: "https://luma.com/notion-x" }),
    ).rejects.toThrow(/isn't valid/i);
  });
});

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
