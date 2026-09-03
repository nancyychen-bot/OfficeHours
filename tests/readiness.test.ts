import { describe, it, expect } from "vitest";
import { evaluateEvent, evaluateCalendar, type EventCheckInput } from "@/lib/readiness/evaluate";

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
