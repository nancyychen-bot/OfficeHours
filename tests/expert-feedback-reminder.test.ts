import { describe, it, expect } from "vitest";
import {
  dueReminderPrompts,
  sendFeedbackReminders,
  type ReminderCandidateRow,
  type ReminderDeps,
} from "../lib/events/expert-feedback";

const NOW = new Date("2026-10-02T20:00:00Z");

function cand(over: Partial<ReminderCandidateRow> & Pick<ReminderCandidateRow, "expert_email" | "booking_id">): ReminderCandidateRow {
  return {
    event_id: "ev1",
    expert_name: "Expert",
    guest_name: "Guest",
    guest_email: "g@x.com",
    created_at: "2026-10-02T00:00:00Z", // 20h before NOW
    responded_at: null,
    ...over,
  };
}

describe("dueReminderPrompts (18h, zero-feedback only)", () => {
  it("includes an expert with no responses whose prompt is >= 18h old", () => {
    const rows = [
      cand({ expert_email: "a@x.com", booking_id: "b1" }),
      cand({ expert_email: "a@x.com", booking_id: "b2" }),
    ];
    const due = dueReminderPrompts(rows, NOW, 18);
    expect(due).toHaveLength(1);
    expect(due[0].email).toBe("a@x.com");
    expect(due[0].items.map((i) => i.bookingId).sort()).toEqual(["b1", "b2"]);
  });

  it("excludes an expert who gave ANY feedback (zero-feedback rule)", () => {
    const rows = [
      cand({ expert_email: "a@x.com", booking_id: "b1", responded_at: "2026-10-02T01:00:00Z" }),
      cand({ expert_email: "a@x.com", booking_id: "b2" }),
    ];
    expect(dueReminderPrompts(rows, NOW, 18)).toEqual([]);
  });

  it("excludes an expert whose prompt is younger than 18h", () => {
    const rows = [cand({ expert_email: "c@x.com", booking_id: "b3", created_at: "2026-10-02T10:00:00Z" })]; // 10h
    expect(dueReminderPrompts(rows, NOW, 18)).toEqual([]);
  });
});

function makeDeps(
  rows: ReminderCandidateRow[],
  dm: ReminderDeps["dm"],
): { deps: ReminderDeps; reminded: string[]; failures: string[] } {
  const reminded: string[] = [];
  const failures: string[] = [];
  const deps: ReminderDeps = {
    loadCandidates: async () => rows,
    now: () => NOW,
    dm,
    markReminded: async (_eventId, email) => { reminded.push(email); },
    onFailure: async (_eventId, email) => { failures.push(email); },
  };
  return { deps, reminded, failures };
}

describe("sendFeedbackReminders", () => {
  it("nudges due experts, marks them reminded, and counts them", async () => {
    const rows = [cand({ expert_email: "a@x.com", booking_id: "b1" })];
    const { deps, reminded, failures } = makeDeps(rows, async () => ({ ok: true }));
    const n = await sendFeedbackReminders(deps);
    expect(n).toBe(1);
    expect(reminded).toEqual(["a@x.com"]);
    expect(failures).toEqual([]);
  });

  it("does NOT mark reminded when the DM fails, so the cron retries", async () => {
    const rows = [cand({ expert_email: "a@x.com", booking_id: "b1" })];
    const { deps, reminded, failures } = makeDeps(rows, async () => ({ ok: false, error: "user_not_found" }));
    const n = await sendFeedbackReminders(deps);
    expect(n).toBe(0);
    expect(reminded).toEqual([]);
    expect(failures).toEqual(["a@x.com"]);
  });
});
