import { describe, it, expect } from "vitest";
import {
  selectEventForFeedback,
  selectHelperBooking,
  isoDateMinusDays,
  type EventCandidate,
  type HelperCandidate,
} from "../lib/db/feedback";
import { parseSatisfactionScore, enrichmentProperties, FB } from "../lib/notion/feedback";

describe("parseSatisfactionScore", () => {
  it("extracts a leading integer, ignoring copy", () => {
    expect(parseSatisfactionScore("5 - Amazing")).toBe(5);
    expect(parseSatisfactionScore("3")).toBe(3);
    expect(parseSatisfactionScore("1 - Poor")).toBe(1);
  });
  it("returns null when there is no leading digit", () => {
    expect(parseSatisfactionScore("Amazing")).toBeNull();
    expect(parseSatisfactionScore("")).toBeNull();
    expect(parseSatisfactionScore(null)).toBeNull();
    expect(parseSatisfactionScore(undefined)).toBeNull();
  });
});

describe("isoDateMinusDays", () => {
  it("subtracts days without tz drift", () => {
    expect(isoDateMinusDays("2026-08-10", 7)).toBe("2026-08-03");
    expect(isoDateMinusDays("2026-08-01", 7)).toBe("2026-07-25");
  });
});

describe("selectEventForFeedback", () => {
  const submittedAt = "2026-08-10T18:00:00.000Z"; // submission date 2026-08-10
  const mk = (id: string, date: string, city: string | null = "New York"): EventCandidate => ({
    eventId: id,
    eventDate: date,
    city,
    helperName: null,
  });

  it("returns null when there are no candidates", () => {
    expect(selectEventForFeedback([], submittedAt)).toBeNull();
  });

  it("includes an event exactly 7 days before (window boundary, inclusive)", () => {
    const r = selectEventForFeedback([mk("a", "2026-08-03")], submittedAt);
    expect(r?.eventId).toBe("a");
  });

  it("excludes an event 8 days before (just outside the window)", () => {
    expect(selectEventForFeedback([mk("a", "2026-08-02")], submittedAt)).toBeNull();
  });

  it("excludes events dated after the submission", () => {
    expect(selectEventForFeedback([mk("a", "2026-08-11")], submittedAt)).toBeNull();
  });

  it("picks the most recent event when several are in the window", () => {
    const r = selectEventForFeedback(
      [mk("older", "2026-08-05", "SF"), mk("newer", "2026-08-09", "New York")],
      submittedAt,
    );
    expect(r?.eventId).toBe("newer");
    expect(r?.city).toBe("New York");
  });
});

describe("selectHelperBooking", () => {
  const submittedAt = "2026-08-10T18:00:00.000Z"; // submission date 2026-08-10
  const mk = (id: string, date: string, helperName: string | null): HelperCandidate => ({
    eventId: id,
    eventDate: date,
    helperName,
  });

  it("returns null when there are no candidates", () => {
    expect(selectHelperBooking([], submittedAt)).toBeNull();
  });

  it("returns null when no candidate has an assigned helper", () => {
    expect(selectHelperBooking([mk("a", "2026-08-09", null)], submittedAt)).toBeNull();
  });

  it("picks the most recent booking that HAS a helper, skipping a newer no-helper booking", () => {
    const r = selectHelperBooking(
      [
        mk("old", "2026-06-01", "Ada"),
        mk("recent", "2026-08-09", "Grace"),
        mk("newest-no-helper", "2026-08-10", null),
      ],
      submittedAt,
    );
    expect(r).toEqual({ eventId: "recent", helperName: "Grace" });
  });

  it("excludes bookings dated after submission (can't review a future event)", () => {
    const r = selectHelperBooking(
      [mk("future", "2026-08-20", "Future"), mk("past", "2026-08-05", "Past")],
      submittedAt,
    );
    expect(r?.helperName).toBe("Past");
  });

  it("has no lower-bound window — an older-than-7-days 1:1 still counts", () => {
    const r = selectHelperBooking([mk("old", "2026-07-01", "Ada")], submittedAt);
    expect(r?.helperName).toBe("Ada");
  });
});

describe("enrichmentProperties (helper-only; agent owns event/location/date)", () => {
  it("writes the Notion Expert, satisfaction score, and title", () => {
    const p = enrichmentProperties({ guestName: "Glenelys", helperName: "Jenna", satisfactionScore: 5 });
    expect(p[FB.helper]).toEqual({ rich_text: [{ type: "text", text: { content: "Jenna" } }] });
    expect(p[FB.satisfactionScore]).toEqual({ number: 5 });
    expect(p[FB.title]).toBeDefined();
  });

  it("does NOT write agent-owned fields (Event Date, Location, Needs review)", () => {
    const p = enrichmentProperties({ guestName: "G", helperName: null, satisfactionScore: null });
    expect(p).not.toHaveProperty(FB.eventDate);
    expect(p).not.toHaveProperty(FB.location);
    expect(p).not.toHaveProperty(FB.needsReview);
  });

  it("writes an empty Notion Expert when there is no helper", () => {
    const p = enrichmentProperties({ guestName: "G", helperName: null, satisfactionScore: null });
    expect(p[FB.helper]).toEqual({ rich_text: [] });
  });
});
