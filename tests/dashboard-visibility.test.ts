import { describe, it, expect } from "vitest";
import { isDashboardEvent, filterToEvents } from "../lib/hub/visibility";

describe("isDashboardEvent", () => {
  it("shows our Build Bar / Office Hours events", () => {
    expect(isDashboardEvent({ name: "Notion Build Bar Sydney" })).toBe(true);
    expect(isDashboardEvent({ name: "10월 Notion Seoul Office Hours" })).toBe(true);
    expect(isDashboardEvent({ name: "Notion Build Bar SF", hidden: false })).toBe(true);
  });

  it("hides non-Build-Bar events on shared calendars (by name)", () => {
    expect(isDashboardEvent({ name: "AI Labs Singapore" })).toBe(false);
    expect(isDashboardEvent({ name: "How AI are you? Come find out." })).toBe(false);
    expect(isDashboardEvent({ name: "AI Transformation Executive Dinner" })).toBe(false);
    expect(isDashboardEvent({ name: "Notion 101 for Small Businesses NYC" })).toBe(false);
    expect(isDashboardEvent({ name: "LifeOS- Build your own all-in-one Ft. Notion, Collage" })).toBe(false);
    expect(isDashboardEvent({ name: null })).toBe(false);
  });

  it("hides an explicitly archived event even when its name matches", () => {
    expect(isDashboardEvent({ name: "Notion Build Bar Test", hidden: true })).toBe(false);
  });
});

describe("filterToEvents", () => {
  const events = [{ luma_event_id: "evt-a" }, { luma_event_id: "evt-b" }];
  const bookings = [
    { luma_event_id: "evt-a", id: 1 },
    { luma_event_id: "evt-b", id: 2 },
    { luma_event_id: "evt-junk", id: 3 }, // a hidden/non-visible event's booking
  ];
  const feedback = [
    { luma_event_id: "evt-a" },
    { luma_event_id: "evt-junk" },
    { luma_event_id: null }, // unattributed
  ];

  it("keeps only bookings for visible events", () => {
    const { bookings: b } = filterToEvents(events, bookings, feedback);
    expect(b.map((x) => x.id)).toEqual([1, 2]);
  });

  it("drops feedback for non-visible events but keeps unattributed", () => {
    const { feedback: f } = filterToEvents(events, bookings, feedback);
    expect(f).toEqual([{ luma_event_id: "evt-a" }, { luma_event_id: null }]);
  });
});
