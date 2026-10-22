import { describe, it, expect } from "vitest";
import { cityForEvent, type CityRow } from "../lib/comms/city";

const CITIES: CityRow[] = [
  { slug: "seoul", name: "Seoul", locale: "ko", luma_calendar: "korea", aliases: [] },
  { slug: "sydney", name: "Sydney", locale: "en", luma_calendar: "sydney", aliases: ["Chippendale", "Ultimo"] },
  { slug: "singapore", name: "Singapore", locale: "en", luma_calendar: "singapore", aliases: [] },
  { slug: "nyc", name: "New York", locale: "en", luma_calendar: "notion-master", aliases: ["NYC"] },
  { slug: "sf", name: "San Francisco", locale: "en", luma_calendar: "notion-master", aliases: ["SF"] },
];

describe("cityForEvent", () => {
  it("matches by name, case-insensitive", () => {
    expect(cityForEvent({ city: "Seoul", luma_calendar: "korea" }, CITIES)).toBe("seoul");
    expect(cityForEvent({ city: "seoul", luma_calendar: "korea" }, CITIES)).toBe("seoul");
    expect(cityForEvent({ city: "New York", luma_calendar: "notion-master" }, CITIES)).toBe("nyc");
  });
  it("matches by alias", () => {
    expect(cityForEvent({ city: "Chippendale", luma_calendar: "sydney" }, CITIES)).toBe("sydney");
  });
  it("falls back to a calendar that uniquely identifies one city", () => {
    expect(cityForEvent({ city: "Somewhere", luma_calendar: "singapore" }, CITIES)).toBe("singapore");
  });
  it("returns null when name/alias miss and the calendar is ambiguous", () => {
    expect(cityForEvent({ city: "Austin", luma_calendar: "notion-master" }, CITIES)).toBeNull();
  });
  it("returns null for an empty city and unknown calendar", () => {
    expect(cityForEvent({ city: "", luma_calendar: "zzz" }, CITIES)).toBeNull();
  });
});
