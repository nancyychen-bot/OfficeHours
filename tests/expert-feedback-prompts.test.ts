import { describe, it, expect } from "vitest";
import { buildFeedbackPrompts, lastSlotEndedHoursAgo } from "../lib/events/expert-feedback";

const row = (over: Record<string, unknown>) => ({
  id: "b1", guest_name: "Ada", guest_email: "ada@x.com", challenge: "Roadmaps",
  slot_name: "2:00 PM", slot_starts_at: "2026-08-26T18:00:00Z",
  booked_by_email: "grace@x.com", booked_by_display_name: "Grace Hopper",
  status: "checked_in", event_id: "e1", event_name: "NYC", event_date: "2026-08-26", ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

describe("lastSlotEndedHoursAgo", () => {
  const now = new Date("2026-08-26T23:00:00Z");
  it("true when the latest slot ended >= threshold hours ago", () => {
    // latest slot ends 20:30Z → 2.5h before now
    expect(lastSlotEndedHoursAgo(["2026-08-26T20:00:00Z", "2026-08-26T20:30:00Z"], 2, now)).toBe(true);
  });
  it("false when the latest slot is too recent", () => {
    // latest slot ends 22:30Z → 0.5h before now
    expect(lastSlotEndedHoursAgo(["2026-08-26T22:30:00Z"], 2, now)).toBe(false);
  });
  it("false when there are no slots", () => {
    expect(lastSlotEndedHoursAgo([], 2, now)).toBe(false);
  });
});

describe("buildFeedbackPrompts", () => {
  it("groups by expert, keeps booking ids, ignores unclaimed/cancelled/no-show", () => {
    const prompts = buildFeedbackPrompts([
      row({ id: "b1", booked_by_email: "grace@x.com" }),
      row({ id: "b2", booked_by_email: "grace@x.com", guest_name: "Bo", status: "assigned" }),
      row({ id: "b3", booked_by_email: null }),
      row({ id: "b4", booked_by_email: "grace@x.com", status: "no_show" }),
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].email).toBe("grace@x.com");
    expect(prompts[0].items.map((i) => i.bookingId)).toEqual(["b1", "b2"]);
  });
});
