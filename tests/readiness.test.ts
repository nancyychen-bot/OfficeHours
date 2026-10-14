import { describe, it, expect } from "vitest";
import { evaluateEvent, evaluateCalendar, type EventCheckInput } from "@/lib/readiness/evaluate";
import { parseUnknownEventNote, isOurEventName } from "@/lib/readiness/untracked";

describe("isOurEventName", () => {
  it("matches Build Bar / Office Hours events (our events)", () => {
    expect(isOurEventName("Notion Build Bar Sydney")).toBe(true);
    expect(isOurEventName("Notion Office Hours — Tokyo")).toBe(true);
    expect(isOurEventName("BuildBar SF")).toBe(true);
  });
  it("ignores other events on the shared calendars", () => {
    expect(isOurEventName("NYC Tech Week: How Notion Builds Notion")).toBe(false);
    expect(isOurEventName("AI Labs 2.0")).toBe(false);
    expect(isOurEventName(null)).toBe(false);
  });
});

describe("parseUnknownEventNote", () => {
  it("extracts the event id, guest name, and email from a real note", () => {
    const note = "not a registered Notion Build Bar event (evt-FQYbHPek0zXoYgC) — guest Keisuke Okui <keisuke@makenotion.com>";
    expect(parseUnknownEventNote(note)).toEqual({
      eventId: "evt-FQYbHPek0zXoYgC",
      guestName: "Keisuke Okui",
      guestEmail: "keisuke@makenotion.com",
    });
  });
  it("handles a missing guest gracefully", () => {
    expect(parseUnknownEventNote("something with evt-ABC123 but no guest")).toEqual({
      eventId: "evt-ABC123",
      guestName: null,
      guestEmail: null,
    });
  });
});

const okEvent: EventCheckInput = {
  city: "Seoul",
  timezone: "Asia/Seoul",
  address: "685 Market St",
  slotCount: 4,
  calendarConnected: true,
  slack: { postable: true, botInChannel: true, channelName: "#build-bar-seoul" },
};

describe("evaluateEvent", () => {
  it("returns no issues for a fully-configured event", () => {
    expect(evaluateEvent(okEvent)).toEqual([]);
  });

  it("errors when the calendar isn't connected", () => {
    const issues = evaluateEvent({ ...okEvent, calendarConnected: false });
    expect(issues.some((i) => i.level === "error" && /calendar isn't connected/i.test(i.message))).toBe(true);
  });

  it("errors when there are no slots", () => {
    const issues = evaluateEvent({ ...okEvent, slotCount: 0 });
    expect(issues.some((i) => i.level === "error" && /no time slots/i.test(i.message))).toBe(true);
  });

  it("errors on no city and does NOT then also complain about slack (city is the root cause)", () => {
    const issues = evaluateEvent({ ...okEvent, city: null, slack: null });
    expect(issues.some((i) => /no city/i.test(i.message))).toBe(true);
    expect(issues.some((i) => /slack channel/i.test(i.message))).toBe(false);
  });

  it("errors when the city has no postable Slack channel", () => {
    const issues = evaluateEvent({ ...okEvent, slack: null });
    expect(issues.some((i) => i.level === "error" && /no slack channel for seoul/i.test(i.message))).toBe(true);
  });

  it("warns (not errors) when the channel exists but the bot isn't in it", () => {
    const issues = evaluateEvent({ ...okEvent, slack: { postable: true, botInChannel: false, channelName: "#build-bar-seoul" } });
    const botIssue = issues.find((i) => /isn't in/i.test(i.message));
    expect(botIssue?.level).toBe("warn");
  });

  it("warns on missing timezone and address", () => {
    const issues = evaluateEvent({ ...okEvent, timezone: null, address: null });
    expect(issues.filter((i) => i.level === "warn").map((i) => i.message).join(" ")).toMatch(/timezone.*|address/i);
    expect(issues.every((i) => i.level === "warn")).toBe(true);
  });
});

describe("evaluateEvent — RSVP sync gap (bookings << Luma registered)", () => {
  it("errors when far fewer bookings are synced than Luma shows registered", () => {
    const issues = evaluateEvent({ ...okEvent, lumaRegistered: 242, bookingCount: 14 });
    expect(issues.some((i) => i.level === "error" && /rsvp|synced|registered/i.test(i.message))).toBe(true);
  });

  it("does not alarm when bookings roughly match Luma registered", () => {
    const issues = evaluateEvent({ ...okEvent, lumaRegistered: 30, bookingCount: 29 });
    expect(issues.some((i) => /rsvp|synced/i.test(i.message))).toBe(false);
  });

  it("does not alarm on a tiny absolute gap (webhook lag on a small event)", () => {
    const issues = evaluateEvent({ ...okEvent, lumaRegistered: 8, bookingCount: 2 });
    expect(issues.some((i) => /rsvp|synced/i.test(i.message))).toBe(false);
  });

  it("does not alarm when the Luma registered count is unknown (stats not synced yet)", () => {
    const issues = evaluateEvent({ ...okEvent, lumaRegistered: null, bookingCount: 0 });
    expect(issues.some((i) => /rsvp|synced/i.test(i.message))).toBe(false);
  });
});

describe("evaluateEvent — form anomalies", () => {
  const base = {
    city: "Seoul", timezone: "Asia/Seoul", address: "123 St", slotCount: 4,
    calendarConnected: true,
    slack: { postable: true, botInChannel: true, channelName: "#x" },
  };

  it("reports an error when the form has anomalies", () => {
    const issues = evaluateEvent({ ...base, formAnomalies: ["no question with time-slot options"] });
    expect(issues.some((i) => i.level === "error" && /form shape/i.test(i.message))).toBe(true);
  });

  it("reports nothing extra when there are no anomalies", () => {
    const clean = evaluateEvent({ ...base, formAnomalies: [] });
    expect(clean.some((i) => /form shape/i.test(i.message))).toBe(false);
  });
});

describe("evaluateCalendar", () => {
  it("no issues for a valid key with a webhook secret", () => {
    expect(evaluateCalendar({ keyValid: true, hasWebhookSecret: true })).toEqual([]);
  });
  it("errors on a rejected key and on a missing webhook secret", () => {
    const issues = evaluateCalendar({ keyValid: false, hasWebhookSecret: false });
    expect(issues.filter((i) => i.level === "error")).toHaveLength(2);
  });
  it("warns (not errors) when the key couldn't be validated", () => {
    const issues = evaluateCalendar({ keyValid: null, hasWebhookSecret: true });
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warn");
  });
});

import { isTransientLumaOutage, shouldSuppressReadinessEmail, type ReadinessReport } from "@/lib/readiness/check";

function report(p: Partial<ReadinessReport> = {}): ReadinessReport {
  return {
    generatedForDays: 21,
    calendars: [],
    events: [],
    untracked: [],
    errorCount: 0,
    warnCount: 0,
    calendarsChecked: 0,
    calendarsUnreachable: 0,
    ...p,
  };
}

describe("isTransientLumaOutage", () => {
  it("is true when EVERY calendar is unreachable and nothing else is wrong", () => {
    expect(isTransientLumaOutage(report({ calendarsChecked: 5, calendarsUnreachable: 5, warnCount: 5 }))).toBe(true);
  });

  it("is false when a key is actually rejected (an error present)", () => {
    expect(isTransientLumaOutage(report({ calendarsChecked: 5, calendarsUnreachable: 4, errorCount: 1, warnCount: 4 }))).toBe(false);
  });

  it("is false when only SOME calendars are unreachable", () => {
    expect(isTransientLumaOutage(report({ calendarsChecked: 5, calendarsUnreachable: 3, warnCount: 3 }))).toBe(false);
  });

  it("is false when there are extra warnings beyond the unreachable ones (e.g. an event warn)", () => {
    expect(isTransientLumaOutage(report({ calendarsChecked: 5, calendarsUnreachable: 5, warnCount: 6 }))).toBe(false);
  });

  it("is false when there are untracked events to act on", () => {
    expect(
      isTransientLumaOutage(report({ calendarsChecked: 5, calendarsUnreachable: 5, warnCount: 5, untracked: [{} as never] })),
    ).toBe(false);
  });

  it("is false when there are no calendars at all", () => {
    expect(isTransientLumaOutage(report({ calendarsChecked: 0, calendarsUnreachable: 0 }))).toBe(false);
  });
});

describe("shouldSuppressReadinessEmail", () => {
  it("suppresses a first transient outage", () => {
    expect(shouldSuppressReadinessEmail(true, false)).toBe(true);
  });
  it("escalates (does NOT suppress) a transient outage that persisted into a second run", () => {
    expect(shouldSuppressReadinessEmail(true, true)).toBe(false);
  });
  it("never suppresses a non-transient report", () => {
    expect(shouldSuppressReadinessEmail(false, false)).toBe(false);
    expect(shouldSuppressReadinessEmail(false, true)).toBe(false);
  });
});
