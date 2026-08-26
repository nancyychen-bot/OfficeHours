import { describe, it, expect } from "vitest";
import { cityFromAddress, selectNotion101Event, type Notion101Candidate } from "../lib/notion/notion101";

describe("cityFromAddress", () => {
  it("pulls the city out of a US street address", () => {
    expect(cityFromAddress("75 Varick St, New York, NY 10013, USA")).toBe("New York");
    expect(cityFromAddress("123 Main St, San Francisco, CA 94103, USA")).toBe("San Francisco");
    expect(cityFromAddress("500 Terry A Francois Blvd, Portland, OR 97201")).toBe("Portland");
  });

  it("handles a ZIP+4 state segment", () => {
    expect(cityFromAddress("1 Loop, Cupertino, CA 95014-2083, USA")).toBe("Cupertino");
  });

  it("falls back to the whole string when it can't parse", () => {
    expect(cityFromAddress("New York")).toBe("New York");
    expect(cityFromAddress("Online")).toBe("Online");
  });

  it("returns null for empty/nullish input", () => {
    expect(cityFromAddress(null)).toBeNull();
    expect(cityFromAddress("")).toBeNull();
    expect(cityFromAddress("   ")).toBeNull();
  });
});

describe("selectNotion101Event", () => {
  const submittedAt = "2026-08-10T18:00:00.000Z";
  const mk = (date: string, city: string | null, event = "Notion 101"): Notion101Candidate => ({
    eventDate: date,
    city,
    event,
  });

  it("returns null when there are no candidates", () => {
    expect(selectNotion101Event([], submittedAt)).toBeNull();
  });

  it("picks the most recent event on/before the submission date", () => {
    const r = selectNotion101Event([mk("2026-06-01", "SF"), mk("2026-08-09", "New York")], submittedAt);
    expect(r?.eventDate).toBe("2026-08-09");
    expect(r?.city).toBe("New York");
  });

  it("excludes events dated after submission", () => {
    const r = selectNotion101Event([mk("2026-08-20", "Future"), mk("2026-08-05", "Past")], submittedAt);
    expect(r?.city).toBe("Past");
  });
});
