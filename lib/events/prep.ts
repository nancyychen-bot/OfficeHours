import { listBookingsForEvent } from "../db/bookings";
import { listEventsInDateRange } from "../db/events";
import { sendBookingComms } from "../email/comms";
import { isSendDue, scanWindow, SEND_HOUR } from "./schedule";
import type { Booking } from "../sync/types";

/** How many days before an event the prep email goes out. */
export const PREP_LEAD_DAYS = 3;

/**
 * The Notion plan value (verbatim from the Luma dropdown) that means "Free". It's
 * the sole arbiter splitting the two day-before emails — Free gets the Notion AI
 * nudge, everyone else gets the plain checklist — so both predicates key off this
 * one constant. If the Luma option label changes, update it here.
 */
export const FREE_PLAN = "Free";

/**
 * A booking that should get the pre-event prep emails (both the 3-day prep and the
 * day-before reminder): an APPROVED guest on the FREE Notion plan, with an email,
 * not filtered, not cancelled. Free-only because the prep nudges activating a free
 * Notion AI trial (paid plans don't need it); pending/waitlisted/declined excluded.
 */
export function isEligibleForPrep(b: Booking): boolean {
  return (
    b.luma_status === "approved" &&
    b.notion_plan === FREE_PLAN &&
    !b.filtered &&
    !!b.guest_email &&
    b.status !== "cancelled"
  );
}

/** Send the prep email to every eligible guest of one event. Idempotent (email_log dedup). */
export async function sendPrepForEvent(eventId: string): Promise<number> {
  const bookings = await listBookingsForEvent(eventId);
  const eligible = bookings.filter(isEligibleForPrep);
  for (const b of eligible) {
    await sendBookingComms(b.id, "prep_reminder");
  }
  return eligible.length;
}

/** Send the T-3 prep email at 9am local, PREP_LEAD_DAYS before each event. */
export async function sendPrepForLeadWindow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: -PREP_LEAD_DAYS, targetHour: SEND_HOUR }));
  let guests = 0;
  for (const ev of events) guests += await sendPrepForEvent(ev.id);
  return { events: events.length, guests };
}

/**
 * A booking that should get the NON-Free day-before checklist: an APPROVED guest
 * NOT on the Free plan (paid plans and blank/unknown), with an email, not filtered,
 * not cancelled. Complements isEligibleForPrep so every approved guest gets exactly
 * one day-before checklist. No Notion AI step (that's the Free nudge).
 */
export function isEligibleForDayBeforePaid(b: Booking): boolean {
  return (
    b.luma_status === "approved" &&
    b.notion_plan !== FREE_PLAN &&
    !b.filtered &&
    !!b.guest_email &&
    b.status !== "cancelled"
  );
}

/** Send the non-Free day-before checklist to every eligible guest of one event. Idempotent. */
export async function sendPrepDayBeforePaidForEvent(eventId: string): Promise<number> {
  const eligible = (await listBookingsForEvent(eventId)).filter(isEligibleForDayBeforePaid);
  for (const b of eligible) await sendBookingComms(b.id, "prep_reminder_day_before_paid");
  return eligible.length;
}

/** Send the non-Free day-before checklist at 9am local, the day before each event. */
export async function sendPrepDayBeforePaidForLeadWindow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: -1, targetHour: SEND_HOUR }));
  let guests = 0;
  for (const ev of events) guests += await sendPrepDayBeforePaidForEvent(ev.id);
  return { events: events.length, guests };
}

/** Send the day-before reminder to every eligible guest of one event. Idempotent
 * (distinct email_log kind, so it isn't suppressed by the 3-day prep dedup). */
export async function sendPrepDayBeforeForEvent(eventId: string): Promise<number> {
  const eligible = (await listBookingsForEvent(eventId)).filter(isEligibleForPrep);
  for (const b of eligible) await sendBookingComms(b.id, "prep_reminder_day_before");
  return eligible.length;
}

/** Send the Free day-before reminder at 9am local, the day before each event. */
export async function sendPrepDayBeforeForLeadWindow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: -1, targetHour: SEND_HOUR }));
  let guests = 0;
  for (const ev of events) guests += await sendPrepDayBeforeForEvent(ev.id);
  return { events: events.length, guests };
}
