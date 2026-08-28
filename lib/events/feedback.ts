import { listBookingsForEvent } from "../db/bookings";
import {
  getEventById,
  listEventsInDateRange,
  listEventsPendingFeedback,
  markFeedbackReminderSent,
  markFeedbackSent,
} from "../db/events";
import { listFeedbackRespondentEmails } from "../db/feedback";
import { listSlotsForEvent } from "../db/slots";
import { sendBookingComms } from "../email/comms";
import { isSendDue, scanWindow, SEND_HOUR } from "./schedule";
import type { Booking } from "../sync/types";

/** Days after an event the feedback reminder goes out (to non-responders). */
export const FEEDBACK_REMINDER_OFFSET_DAYS = 2;

/** A booking that should get the post-event feedback email: a checked-in guest. */
export function isEligibleForFeedback(b: Booking): boolean {
  return b.status === "checked_in" && !!b.guest_email;
}

/** A checked-in guest who hasn't submitted feedback (by guest OR notion email). */
export function isEligibleForFeedbackReminder(b: Booking, responded: Set<string>): boolean {
  if (!isEligibleForFeedback(b)) return false;
  const g = b.guest_email.trim().toLowerCase();
  const n = (b.notion_email ?? "").trim().toLowerCase();
  return !responded.has(g) && !(n !== "" && responded.has(n));
}

/** Send the feedback email to every checked-in guest of one event. Idempotent (email_log dedup). */
export async function sendFeedbackForEvent(eventId: string): Promise<number> {
  const eligible = (await listBookingsForEvent(eventId)).filter(isEligibleForFeedback);
  for (const b of eligible) {
    await sendBookingComms(b.id, "feedback_request");
  }
  return eligible.length;
}

/** The latest slot end for an event (its effective end time), or null if it has no slots. */
export async function eventEndsAt(eventId: string): Promise<string | null> {
  const slots = await listSlotsForEvent(eventId);
  if (slots.length === 0) return null;
  return slots.reduce((max, s) => (s.ends_at > max ? s.ends_at : max), slots[0].ends_at);
}

/**
 * Dispatch feedback for every event whose last slot has ended and that hasn't
 * been dispatched yet — the "send the minute the event ends" automation. Marks
 * each event so it never re-sends. Runs from the per-minute cron.
 */
export async function dispatchFeedbackForEndedEvents(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const nowISO = now.toISOString();
  const pending = await listEventsPendingFeedback();
  let events = 0;
  let guests = 0;
  for (const ev of pending) {
    const endsAt = await eventEndsAt(ev.id);
    if (!endsAt || endsAt > nowISO) continue; // not ended yet (or no slots to time off)
    guests += await sendFeedbackForEvent(ev.id);
    await markFeedbackSent(ev.id, nowISO);
    events++;
  }
  return { events, guests };
}

/**
 * Send the feedback reminder to every checked-in guest of one event who hasn't
 * responded yet. Idempotent (distinct email_log kind, so it isn't suppressed by
 * the first feedback_request send). Returns the number of guests emailed.
 */
export async function sendFeedbackReminderForEvent(eventId: string): Promise<number> {
  const event = await getEventById(eventId);
  if (!event) return 0;
  const responded = await listFeedbackRespondentEmails({ id: event.id, eventDate: event.event_date });
  const eligible = (await listBookingsForEvent(eventId)).filter((b) => isEligibleForFeedbackReminder(b, responded));
  for (const b of eligible) await sendBookingComms(b.id, "feedback_reminder");
  return eligible.length;
}

/**
 * Dispatch the feedback reminder for every event that reached (event_date + 2)
 * at 9am event-local and hasn't been reminded yet. Marks each event so it never
 * re-sends. Runs from the hourly cron. Only checked-in non-responders are emailed.
 */
export async function dispatchFeedbackRemindersForDueEvents(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const due = (await listEventsInDateRange(from, to)).filter(
    (e) =>
      e.feedback_sent_at != null &&
      e.feedback_reminder_sent_at == null &&
      isSendDue(now, e, { offsetDays: FEEDBACK_REMINDER_OFFSET_DAYS, targetHour: SEND_HOUR }),
  );
  let events = 0;
  let guests = 0;
  for (const ev of due) {
    guests += await sendFeedbackReminderForEvent(ev.id);
    await markFeedbackReminderSent(ev.id, now.toISOString());
    events++;
  }
  return { events, guests };
}
