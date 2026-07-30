import { describe, it, expect } from "vitest";
import { localCalendarDate } from "@/lib/events/event-date";

describe("localCalendarDate", () => {
  it("uses the local date in the event timezone (Tokyo rolls to next day)", () => {
    // 2026-08-26T16:00Z is 2026-08-27 01:00 in Tokyo (UTC+9)
    expect(localCalendarDate("2026-08-26T16:00:00.000Z", "Asia/Tokyo")).toBe("2026-08-27");
  });
  it("uses the local date for US Pacific (UTC evening is still same-day PT)", () => {
    // 2026-08-27T01:00Z is 2026-08-26 18:00 in LA (UTC-7)
    expect(localCalendarDate("2026-08-27T01:00:00.000Z", "America/Los_Angeles")).toBe("2026-08-26");
  });
});
