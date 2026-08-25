import { isSendDue, SEND_HOUR } from "./schedule";

/**
 * Decide which recruit reminders are due for still-open recruited bookings.
 * Pure + unit-tested; the caller (comms/recruit cron) fetches candidates and
 * posts. "Never after the event" is enforced by the candidate query, not here.
 *
 * - r1: 3 days after the first recruit post (slack_recruit_posted_at).
 * - r2: at 9am event-local, r2DaysBeforeEvent calendar days before the event.
 * Stages already stamped (r1_at / r2_at set) are skipped. Both due the same day
 * collapse into one entry so the caller posts once and marks both.
 */
export interface RecruitReminderRow {
  id: string;
  slack_recruit_posted_at: string; // non-null (candidates only)
  slack_recruit_r1_at: string | null;
  slack_recruit_r2_at: string | null;
  event_date: string; // "YYYY-MM-DD"
  timezone: string;
}

export interface DueReminder {
  id: string;
  stages: Array<"r1" | "r2">;
}

export function selectDueRecruitReminders(
  rows: RecruitReminderRow[],
  nowMs: number,
  r1AfterMs = 3 * 24 * 60 * 60_000,
  r2DaysBeforeEvent = 2,
): DueReminder[] {
  const now = new Date(nowMs);
  const out: DueReminder[] = [];
  for (const r of rows) {
    const stages: Array<"r1" | "r2"> = [];
    if (r.slack_recruit_r1_at == null && nowMs >= Date.parse(r.slack_recruit_posted_at) + r1AfterMs) {
      stages.push("r1");
    }
    if (r.slack_recruit_r2_at == null && isSendDue(now, { event_date: r.event_date, timezone: r.timezone }, { offsetDays: -r2DaysBeforeEvent, targetHour: SEND_HOUR })) {
      stages.push("r2");
    }
    if (stages.length) out.push({ id: r.id, stages });
  }
  return out;
}
