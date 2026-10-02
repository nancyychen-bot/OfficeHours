import { getAdminClient } from "../supabase/admin";
import { dmByEmail } from "../slack/api";
import { buildFeedbackBlocks } from "../slack/blocks";
import { createFeedbackRows, hasFeedbackRows, deleteFeedbackRows, loadReminderCandidates, markReminderSent, type FeedbackRowInput, type ReminderCandidateRow } from "../db/expert-feedback";
import { logSync } from "../sync/log";

export interface FeedbackDetailRow {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  challenge: string | null;
  slot_name: string | null;
  slot_starts_at: string | null;
  booked_by_email: string | null;
  booked_by_display_name: string | null;
  status: string | null;
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
}

export interface FeedbackItem {
  bookingId: string;
  guestName: string;
  guestEmail: string | null;
  slotName: string | null;
  challenge: string | null;
}

export interface ExpertFeedbackPrompt {
  email: string;
  name: string;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  items: FeedbackItem[];
}

/** Pure: group an event's completed 1:1s into one feedback prompt per expert. Keeps
 * booking ids so each interaction maps back to a row. Only assigned/checked_in. */
export function buildFeedbackPrompts(rows: FeedbackDetailRow[]): ExpertFeedbackPrompt[] {
  const byEmail = new Map<string, ExpertFeedbackPrompt>();
  for (const r of rows) {
    if (!r.booked_by_email) continue;
    if (r.status !== "assigned" && r.status !== "checked_in") continue;
    const key = r.booked_by_email.trim().toLowerCase();
    const p =
      byEmail.get(key) ??
      {
        email: r.booked_by_email,
        name: r.booked_by_display_name ?? "there",
        eventId: r.event_id,
        eventName: r.event_name,
        eventDate: r.event_date,
        items: [] as FeedbackItem[],
      };
    p.items.push({
      bookingId: r.id,
      guestName: r.guest_name ?? "Guest",
      guestEmail: r.guest_email,
      slotName: r.slot_name,
      challenge: r.challenge,
    });
    byEmail.set(key, p);
  }
  for (const p of byEmail.values()) {
    p.items.sort((a, b) => (a.slotName ?? "").localeCompare(b.slotName ?? ""));
  }
  return [...byEmail.values()];
}

/** Pure: has the latest slot's END time passed at least `thresholdHours` before
 * `now`? `slotEndsAt` are ISO strings (slots.ends_at). */
export function lastSlotEndedHoursAgo(slotEndsAt: string[], thresholdHours: number, now: Date): boolean {
  const ends = slotEndsAt.map((s) => Date.parse(s)).filter((n) => Number.isFinite(n));
  if (!ends.length) return false;
  const latestEnd = Math.max(...ends);
  return now.getTime() - latestEnd >= thresholdHours * 3_600_000;
}

/** Seams for sendFeedbackForEvent, so the send/persist/retry behavior is testable
 * without a live Supabase or Slack. Defaults wire the real implementations. */
export interface FeedbackSendDeps {
  loadRows: (eventId: string) => Promise<FeedbackDetailRow[]>;
  alreadyPrompted: (eventId: string, expertEmail: string) => Promise<boolean>;
  createRows: (rows: FeedbackRowInput[]) => Promise<void>;
  deleteRows: (eventId: string, expertEmail: string) => Promise<void>;
  dm: (email: string, blocks: unknown[], text: string) => Promise<{ ok: boolean; error?: string }>;
  onFailure: (eventId: string, email: string, error: string) => Promise<void>;
}

const defaultDeps: FeedbackSendDeps = {
  loadRows: async (eventId) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = getAdminClient() as any;
    const { data } = await supabase
      .from("booking_details")
      .select("id, guest_name, guest_email, challenge, slot_name, slot_starts_at, booked_by_email, booked_by_display_name, status, event_id, event_name, event_date")
      .eq("event_id", eventId);
    return (data ?? []) as FeedbackDetailRow[];
  },
  alreadyPrompted: hasFeedbackRows,
  createRows: createFeedbackRows,
  deleteRows: deleteFeedbackRows,
  dm: dmByEmail,
  onFailure: (_eventId, email, error) =>
    logSync({ direction: "luma_in", result: "error", action: "expert_feedback_dm", note: `${email}: ${error}` }),
};

/** Send the feedback DM for one event: build prompts, create rows, DM each expert.
 * Idempotent per (event, expert) via alreadyPrompted. If the DM fails, the rows
 * are removed again so the hourly cron retries next tick (rather than treating a
 * failed send as done). Returns the count of experts actually DM'd. */
export async function sendFeedbackForEvent(
  eventId: string,
  deps: FeedbackSendDeps = defaultDeps,
): Promise<number> {
  const prompts = buildFeedbackPrompts(await deps.loadRows(eventId));
  let prompted = 0;
  for (const p of prompts) {
    if (await deps.alreadyPrompted(eventId, p.email)) continue; // already prompted
    // Rows must exist before the DM: the buttons' responses UPDATE these rows.
    await deps.createRows(
      p.items.map((it) => ({
        bookingId: it.bookingId,
        eventId: p.eventId,
        expertEmail: p.email,
        expertName: p.name,
        guestName: it.guestName,
        guestEmail: it.guestEmail,
      })),
    );
    // dmByEmail is best-effort (returns ok:false, doesn't throw). A failed send
    // must NOT count as prompted, and its rows must be removed so the cron retries.
    const res = await deps.dm(p.email, buildFeedbackBlocks(p), `How did your ${p.eventName ?? "Build Bar"} 1:1s go?`);
    if (!res.ok) {
      await deps.deleteRows(eventId, p.email);
      await deps.onFailure(eventId, p.email, res.error ?? "unknown");
      continue;
    }
    prompted++;
  }
  return prompted;
}

/** Hours to wait after the last slot ends before DMing experts for feedback.
 * 0 = fire at the first hourly cron tick once the event has ended (right as it
 * wraps), rather than the old 2-hour buffer. */
const FEEDBACK_DELAY_HOURS = 0;

/**
 * Send feedback DMs for every event whose last slot has ended (>= FEEDBACK_DELAY_HOURS
 * ago) and hasn't been prompted yet. Returns counts.
 */
export async function sendFeedbackForEndedEvents(now: Date = new Date()): Promise<{ events: number; experts: number }> {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data: events } = await supabase
    .from("events")
    .select("id, status, event_date")
    .in("event_date", [today, yesterday])
    .neq("status", "cancelled");
  let eventsPrompted = 0;
  let experts = 0;
  for (const ev of (events ?? []) as Array<{ id: string; event_date: string }>) {
    const { data: slots } = await supabase.from("slots").select("ends_at").eq("event_id", ev.id);
    const ends = (slots ?? []).map((s: { ends_at: string }) => s.ends_at);
    if (!lastSlotEndedHoursAgo(ends, FEEDBACK_DELAY_HOURS, now)) continue;
    const n = await sendFeedbackForEvent(ev.id);
    if (n > 0) { eventsPrompted++; experts += n; }
  }
  return { events: eventsPrompted, experts };
}

export type { ReminderCandidateRow };

/** Hours after the feedback prompt to send a single "don't forget" nudge. */
export const REMINDER_DELAY_HOURS = 18;

/**
 * Pure: from un-reminded feedback rows, pick the experts to nudge — those who gave
 * ZERO feedback (every row still unanswered) and whose most-recent prompt is at
 * least `thresholdHours` old — and build one prompt each (buttons reference the
 * same booking ids, so the nudge is actionable in place).
 */
export function dueReminderPrompts(
  rows: ReminderCandidateRow[],
  now: Date,
  thresholdHours: number,
): ExpertFeedbackPrompt[] {
  const groups = new Map<string, ReminderCandidateRow[]>();
  for (const r of rows) {
    const key = `${r.event_id ?? ""}|${r.expert_email.trim().toLowerCase()}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }
  const cutoff = now.getTime() - thresholdHours * 3_600_000;
  const out: ExpertFeedbackPrompt[] = [];
  for (const grp of groups.values()) {
    if (grp.some((r) => r.responded_at)) continue; // gave some feedback → leave them alone
    const times = grp.map((r) => Date.parse(r.created_at)).filter((n) => Number.isFinite(n));
    if (!times.length || Math.max(...times) > cutoff) continue; // prompt younger than threshold
    const first = grp[0];
    out.push({
      email: first.expert_email,
      name: first.expert_name ?? "there",
      eventId: first.event_id,
      eventName: null,
      eventDate: null,
      items: grp.map((r) => ({
        bookingId: r.booking_id,
        guestName: r.guest_name ?? "Guest",
        guestEmail: r.guest_email,
        slotName: null,
        challenge: null,
      })),
    });
  }
  return out;
}

/** Seams for sendFeedbackReminders — testable without live Supabase/Slack. */
export interface ReminderDeps {
  loadCandidates: () => Promise<ReminderCandidateRow[]>;
  now: () => Date;
  dm: (email: string, blocks: unknown[], text: string) => Promise<{ ok: boolean; error?: string }>;
  markReminded: (eventId: string | null, expertEmail: string) => Promise<void>;
  onFailure: (eventId: string | null, email: string, error: string) => Promise<void>;
}

const defaultReminderDeps: ReminderDeps = {
  loadCandidates: loadReminderCandidates,
  now: () => new Date(),
  dm: dmByEmail,
  markReminded: markReminderSent,
  onFailure: (_eventId, email, error) =>
    logSync({ direction: "luma_in", result: "error", action: "expert_feedback_reminder_dm", note: `${email}: ${error}` }),
};

/**
 * Nudge experts who were prompted >= 18h ago and still gave no feedback. One nudge
 * each (reminder_sent_at guards re-sends). A failed DM is NOT marked reminded, so
 * the hourly cron retries. Returns the count nudged.
 */
export async function sendFeedbackReminders(deps: ReminderDeps = defaultReminderDeps): Promise<number> {
  const due = dueReminderPrompts(await deps.loadCandidates(), deps.now(), REMINDER_DELAY_HOURS);
  let reminded = 0;
  for (const p of due) {
    const res = await deps.dm(
      p.email,
      buildFeedbackBlocks(p, { reminder: true }),
      `Don't forget to give feedback on your ${p.eventName ?? "Build Bar"} 1:1s`,
    );
    if (!res.ok) {
      await deps.onFailure(p.eventId, p.email, res.error ?? "unknown");
      continue;
    }
    await deps.markReminded(p.eventId, p.email);
    reminded++;
  }
  return reminded;
}
