/**
 * Decide which recruit reminders are due for still-open recruited bookings.
 * Pure + unit-tested; the caller (comms/recruit cron) fetches candidates and
 * posts. "Never after the event" is enforced by the candidate query, not here.
 *
 * - r1: 3 days after the first recruit post (slack_recruit_posted_at).
 * - r2: within `r2DaysBeforeEvent` calendar days of the event.
 * Stages already stamped (r1_at / r2_at set) are skipped. Both due the same day
 * collapse into one entry so the caller posts once and marks both.
 */
export interface RecruitReminderRow {
  id: string;
  slack_recruit_posted_at: string; // non-null (candidates only)
  slack_recruit_r1_at: string | null;
  slack_recruit_r2_at: string | null;
  event_date: string; // "YYYY-MM-DD"
}

export interface DueReminder {
  id: string;
  stages: Array<"r1" | "r2">;
}

/** UTC midnight (ms) for a plain "YYYY-MM-DD" — no timezone shift. */
function dateUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function selectDueRecruitReminders(
  rows: RecruitReminderRow[],
  nowMs: number,
  r1AfterMs = 3 * 24 * 60 * 60_000,
  r2DaysBeforeEvent = 2,
): DueReminder[] {
  const now = new Date(nowMs);
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: DueReminder[] = [];
  for (const r of rows) {
    const stages: Array<"r1" | "r2"> = [];
    if (r.slack_recruit_r1_at == null && nowMs >= Date.parse(r.slack_recruit_posted_at) + r1AfterMs) {
      stages.push("r1");
    }
    if (r.slack_recruit_r2_at == null && todayUtcMs >= dateUtcMs(r.event_date) - r2DaysBeforeEvent * 24 * 60 * 60_000) {
      stages.push("r2");
    }
    if (stages.length) out.push({ id: r.id, stages });
  }
  return out;
}
