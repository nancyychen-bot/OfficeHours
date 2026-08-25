import { describe, it, expect } from "vitest";
import { localNowParts, shiftDate, isSendDue } from "../lib/events/schedule";

const at = (iso: string) => new Date(iso);

describe("shiftDate", () => {
  it("shifts calendar days across month/year and DST without drift", () => {
    expect(shiftDate("2026-08-26", -1)).toBe("2026-08-25");
    expect(shiftDate("2026-08-26", -3)).toBe("2026-08-23");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    // US spring-forward weekend (DST gap) — still a clean calendar shift:
    expect(shiftDate("2026-03-09", -1)).toBe("2026-03-08");
  });
});

describe("localNowParts", () => {
  it("reports the event-local date + hour", () => {
    // 2026-08-26T02:00Z → Tokyo (+9) is 11:00 on the 26th; London (+1 BST) 03:00.
    expect(localNowParts(at("2026-08-26T02:00:00Z"), "Asia/Tokyo")).toEqual({ date: "2026-08-26", hour: 11 });
    expect(localNowParts(at("2026-08-26T02:00:00Z"), "Europe/London")).toEqual({ date: "2026-08-26", hour: 3 });
    // 2026-08-26T02:00Z → LA (-7 PDT) is 19:00 the PREVIOUS day.
    expect(localNowParts(at("2026-08-26T02:00:00Z"), "America/Los_Angeles")).toEqual({ date: "2026-08-25", hour: 19 });
  });
});

describe("isSendDue", () => {
  const rule = { offsetDays: -1, targetHour: 9 }; // day-before at 9am local
  it("fires at/after 9am local the day before, for each region", () => {
    const tokyo = { event_date: "2026-08-27", timezone: "Asia/Tokyo" };
    // 2026-08-26T00:00Z = 09:00 Tokyo on the 26th (= day before the 27th) → due
    expect(isSendDue(at("2026-08-26T00:00:00Z"), tokyo, rule)).toBe(true);
    // 2026-08-25T23:00Z = 08:00 Tokyo on the 26th → before 9am → not due
    expect(isSendDue(at("2026-08-25T23:00:00Z"), tokyo, rule)).toBe(false);
    const la = { event_date: "2026-08-27", timezone: "America/Los_Angeles" };
    // 2026-08-26T16:00Z = 09:00 LA on the 26th → due
    expect(isSendDue(at("2026-08-26T16:00:00Z"), la, rule)).toBe(true);
  });
  it("self-heals a missed tick later the same local day, but not the next day", () => {
    const london = { event_date: "2026-08-27", timezone: "Europe/London" };
    // 14:00 London on the 26th (missed 9am) → still due
    expect(isSendDue(at("2026-08-26T13:00:00Z"), london, rule)).toBe(true);
    // 09:00 London on the 27th (the event day) → lapsed, NOT due
    expect(isSendDue(at("2026-08-27T08:00:00Z"), london, rule)).toBe(false);
  });
  it("respects a different offset/hour (prep T-3 at 9am, decline at 8am)", () => {
    const ev = { event_date: "2026-08-27", timezone: "America/Los_Angeles" };
    // T-3 rule: due at 9am LA on the 24th
    expect(isSendDue(at("2026-08-24T16:00:00Z"), ev, { offsetDays: -3, targetHour: 9 })).toBe(true);
    // decline rule (8am) is due at 8am LA on the 26th, before the 9am reminder
    expect(isSendDue(at("2026-08-26T15:00:00Z"), ev, { offsetDays: -1, targetHour: 8 })).toBe(true);
    expect(isSendDue(at("2026-08-26T15:00:00Z"), ev, { offsetDays: -1, targetHour: 9 })).toBe(false); // 8am, reminder not yet
  });
});
