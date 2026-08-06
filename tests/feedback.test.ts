import { describe, it, expect } from "vitest";
import { selectEventForFeedback, isoDateMinusDays, type EventCandidate } from "../lib/db/feedback";
import { parseSatisfactionScore } from "../lib/notion/feedback";

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
