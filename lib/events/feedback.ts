import { listBookingsForEvent } from "../db/bookings";
import { listEventsPendingFeedback, markFeedbackSent } from "../db/events";
import { listSlotsForEvent } from "../db/slots";
import { sendBookingComms } from "../email/comms";
import type { Booking } from "../sync/types";

/** A booking that should get the post-event feedback email: a checked-in guest. */
export function isEligibleForFeedback(b: Booking): boolean {
  return b.status === "checked_in" && !!b.guest_email;
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
