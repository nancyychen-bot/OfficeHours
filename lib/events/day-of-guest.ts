import { getAdminClient } from "../supabase/admin";
import { listEventsInDateRange } from "../db/events";
import { isSendDue, scanWindow, SEND_HOUR } from "./schedule";
import { sendBookingComms } from "../email/comms";

interface ClaimedRow {
  id: string;
  guest_email: string | null;
  slot_name: string | null;
  booked_by_display_name: string | null;
  status: string | null;
}

/**
 * Send each claimed-1:1 guest a "your 1:1 is today" reminder with their slot +
 * expert. The guest counterpart of the day-of agenda. Idempotent via email_log
 * (kind `day_of_guest`), so a repeat call — or the one-off catch-up send plus the
 * morning-of cron — never double-sends. Only bookings with an expert + a slot +
 * a guest email qualify (that's exactly the claimed-1:1 roster).
 */
export async function sendDayOfGuestForEvent(eventId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data } = await supabase
    .from("booking_details")
    .select("id, guest_email, slot_name, booked_by_display_name, status")
    .eq("event_id", eventId);

  const claimed = ((data ?? []) as ClaimedRow[]).filter(
    (b) =>
      (b.status === "assigned" || b.status === "checked_in") &&
      !!b.guest_email &&
      !!b.slot_name &&
      !!b.booked_by_display_name,
  );

  let sent = 0;
  for (const b of claimed) {
    // sendBookingComms reserves (booking, day_of_guest, guest) before sending, so
    // this is the dedup; it also honors the COMMS_ENABLED kill-switch.
    await sendBookingComms(b.id, "day_of_guest");
    sent++;
  }
  return sent;
}

/** Send the day-of guest reminder at 9am local on the event day (same gate as the
 * expert agenda). Driven by the hourly agenda cron; self-heals within the day. */
export async function sendDayOfGuestForToday(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) =>
    isSendDue(now, e, { offsetDays: 0, targetHour: SEND_HOUR }),
  );
  let guests = 0;
  for (const ev of events) guests += await sendDayOfGuestForEvent(ev.id);
  return { events: events.length, guests };
}
