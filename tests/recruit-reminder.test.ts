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
    timezone: "America/Los_Angeles",
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

  it("r2 fires at 9am local two days before the event", () => {
    // r1 already sent so only r2 is in play; posted_at close enough that r1 is not re-due
    const r2Row = row({
      slack_recruit_posted_at: new Date(Date.parse("2026-08-25T16:00:00Z") - DAY).toISOString(),
      slack_recruit_r1_at: new Date(NOW).toISOString(), // r1 already sent
      event_date: "2026-08-27",
      timezone: "America/Los_Angeles",
    });
    // 2026-08-25T16:00Z = 09:00 LA on the 25th (= 2 days before the 27th) → r2 due
    const due = selectDueRecruitReminders([r2Row], Date.parse("2026-08-25T16:00:00Z"));
    expect(due).toEqual([{ id: "b1", stages: ["r2"] }]);
    // 2026-08-25T15:00Z = 08:00 LA → before 9am → not due
    expect(selectDueRecruitReminders([r2Row], Date.parse("2026-08-25T15:00:00Z"))).toEqual([]);
  });

  it("does not mark r2 when the event is more than 2 days out", () => {
    // event_date 2026-08-25, r2 target = 2026-08-23; NOW local date is 2026-08-19 → not due
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - DAY).toISOString(), event_date: "2026-08-25" })],
      NOW,
    );
    expect(r).toEqual([]);
  });

  it("does not mark r2 at exactly 3 days out (tight boundary — event 08-22 vs today 08-19)", () => {
    // event_date 2026-08-22, r2 target = 2026-08-20; NOW local date is 2026-08-19 → not due
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - DAY).toISOString(), event_date: "2026-08-22" })],
      NOW,
    );
    expect(r).toEqual([]);
  });

  it("skips r2 when it was already sent", () => {
    // Even if isSendDue would fire (9am LA on 2026-08-25 for event 2026-08-27),
    // r2_at set → skip; r1 also already sent → row produces no stages
    const r = selectDueRecruitReminders(
      [row({
        slack_recruit_posted_at: new Date(Date.parse("2026-08-25T16:00:00Z") - DAY).toISOString(),
        slack_recruit_r1_at: new Date(NOW).toISOString(),
        event_date: "2026-08-27",
        timezone: "America/Los_Angeles",
        slack_recruit_r2_at: new Date(NOW - DAY).toISOString(),
      })],
      Date.parse("2026-08-25T16:00:00Z"),
    );
    expect(r).toEqual([]);
  });

  it("collapses both stages into one entry when both are due the same day", () => {
    // r1 is due (posted 4 days ago); r2 is due (event 2026-08-27, now at 9am LA on 2026-08-25 = r2 day)
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(Date.parse("2026-08-25T16:00:00Z") - 4 * DAY).toISOString(), event_date: "2026-08-27", timezone: "America/Los_Angeles" })],
      Date.parse("2026-08-25T16:00:00Z"),
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
