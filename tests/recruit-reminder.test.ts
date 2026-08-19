import { describe, it, expect } from "vitest";
import { selectDueRecruitReminders, type RecruitReminderRow } from "@/lib/events/recruit-reminder";

const NOW = Date.parse("2026-08-19T15:00:00.000Z");
const DAY = 24 * 60 * 60_000;

function row(over: Partial<RecruitReminderRow> = {}): RecruitReminderRow {
  return {
    id: "b1",
    slack_recruit_posted_at: new Date(NOW - 10 * DAY).toISOString(), // long ago
    slack_recruit_r1_at: null,
    slack_recruit_r2_at: null,
    event_date: "2026-09-30", // far future
    ...over,
  };
}

describe("selectDueRecruitReminders", () => {
  it("marks r1 due once 3 days have passed since the first post", () => {
    const r = selectDueRecruitReminders([row({ slack_recruit_posted_at: new Date(NOW - 3 * DAY).toISOString() })], NOW);
    expect(r).toEqual([{ id: "b1", stages: ["r1"] }]);
  });

  it("does not mark r1 before 3 days have passed", () => {
    const r = selectDueRecruitReminders([row({ slack_recruit_posted_at: new Date(NOW - 2 * DAY).toISOString() })], NOW);
    expect(r).toEqual([]);
  });

  it("skips r1 when it was already sent", () => {
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - 5 * DAY).toISOString(), slack_recruit_r1_at: new Date(NOW - DAY).toISOString() })],
      NOW,
    );
    expect(r).toEqual([]);
  });

  it("marks r2 due when today is within 2 calendar days of the event", () => {
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - DAY).toISOString(), event_date: "2026-08-21" })],
      NOW,
    );
    expect(r).toEqual([{ id: "b1", stages: ["r2"] }]);
  });

  it("does not mark r2 when the event is more than 2 days out", () => {
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - DAY).toISOString(), event_date: "2026-08-25" })],
      NOW,
    );
    expect(r).toEqual([]);
  });

  it("does not mark r2 at exactly 3 days out (tight boundary — event 08-22 vs today 08-19)", () => {
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - DAY).toISOString(), event_date: "2026-08-22" })],
      NOW,
    );
    expect(r).toEqual([]);
  });

  it("skips r2 when it was already sent", () => {
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - DAY).toISOString(), event_date: "2026-08-21", slack_recruit_r2_at: new Date(NOW - DAY).toISOString() })],
      NOW,
    );
    expect(r).toEqual([]);
  });

  it("collapses both stages into one entry when both are due the same day", () => {
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - 4 * DAY).toISOString(), event_date: "2026-08-20" })],
      NOW,
    );
    expect(r).toEqual([{ id: "b1", stages: ["r1", "r2"] }]);
  });

  it("returns only rows that have a due stage", () => {
    const rows = [
      row({ id: "due", slack_recruit_posted_at: new Date(NOW - 3 * DAY).toISOString() }),
      row({ id: "notdue", slack_recruit_posted_at: new Date(NOW - DAY).toISOString() }),
    ];
    expect(selectDueRecruitReminders(rows, NOW)).toEqual([{ id: "due", stages: ["r1"] }]);
  });
});
