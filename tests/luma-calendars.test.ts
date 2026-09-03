import { describe, it, expect, vi, afterEach } from "vitest";
import { mapCalendarRow } from "@/lib/db/luma-calendars";

afterEach(() => vi.restoreAllMocks());

describe("mapCalendarRow", () => {
  it("maps snake_case DB columns to the camelCase row shape", () => {
    expect(
      mapCalendarRow({
        id: "london", api_key: "secret-x", webhook_secret: null,
        calendar_id: "cal-1", city: "London", calendar_url: "https://luma.com/notion-london",
      }),
    ).toEqual({
      id: "london", apiKey: "secret-x", webhookSecret: null,
      calendarId: "cal-1", city: "London", calendarUrl: "https://luma.com/notion-london",
    });
  });
});
