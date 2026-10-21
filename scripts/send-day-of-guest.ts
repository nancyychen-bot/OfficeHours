/**
 * Send the day-of 1:1 reminder (kind `day_of_guest`) to an event's claimed-1:1
 * guests — their slot + expert. Idempotent via email_log, so re-runs and the
 * morning-of agenda cron never double-send.
 *
 * DRY RUN by default: lists the recipients and renders one real sample, sends
 * nothing. Pass --send to actually send.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/send-day-of-guest.ts            # dry run, Sydney
 *   npx tsx --env-file=.env.local scripts/send-day-of-guest.ts --send     # real send, Sydney
 *   npx tsx --env-file=.env.local scripts/send-day-of-guest.ts <eventId> --send
 */
import { getAdminClient } from "../lib/supabase/admin";
import { getBookingDetailsById } from "../lib/db/bookings";
import { getEventById } from "../lib/db/events";
import { toCommsFields } from "../lib/email/comms";
import { renderComms } from "../lib/email/templates";
import { calendarUrlForCalendar } from "../lib/luma/calendars";
import { sendDayOfGuestForEvent } from "../lib/events/day-of-guest";

async function resolveEventId(arg: string | undefined): Promise<string> {
  if (arg && arg.startsWith("evt") === false && arg.length > 20) return arg; // looks like a uuid
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("events")
    .select("id, name, city, event_date")
    .gte("event_date", today)
    .order("event_date", { ascending: true });
  const ev = (data ?? []).find(
    (e: { name: string; city: string }) =>
      e.city.toLowerCase().includes("sydney") || e.name.toLowerCase().includes("sydney"),
  );
  if (!ev) throw new Error("No upcoming Sydney event found; pass an event id explicitly.");
  return ev.id as string;
}

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes("--send");
  const eventId = await resolveEventId(args.find((a) => a !== "--send"));

  const ev = await getEventById(eventId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data } = await supabase
    .from("booking_details")
    .select("id, guest_name, guest_email, slot_name, slot_starts_at, booked_by_display_name, status")
    .eq("event_id", eventId);

  const claimed = (data ?? [])
    .filter(
      (b: { status: string; guest_email: string | null; slot_name: string | null; booked_by_display_name: string | null }) =>
        (b.status === "assigned" || b.status === "checked_in") && !!b.guest_email && !!b.slot_name && !!b.booked_by_display_name,
    )
    .sort((a: { slot_starts_at: string | null }, b: { slot_starts_at: string | null }) =>
      (a.slot_starts_at ?? "").localeCompare(b.slot_starts_at ?? ""),
    );

  console.log(`Event: ${ev?.name} — ${ev?.event_date} (${ev?.timezone})`);
  console.log(`Claimed 1:1 guests who will receive day_of_guest: ${claimed.length}\n`);
  for (const b of claimed) {
    console.log(`  ${(b.slot_name ?? "—").padEnd(12)} ${(b.guest_name ?? "—").padEnd(26)} ${(b.guest_email ?? "—").padEnd(34)} → ${b.booked_by_display_name}`);
  }

  // Render one real sample (first guest) so the copy can be eyeballed.
  if (claimed.length) {
    const d = await getBookingDetailsById(claimed[0].id);
    if (d) {
      const f = toCommsFields(d);
      const e = d.event_id ? await getEventById(d.event_id as string) : null;
      f.eventUrl = e?.public_url ?? null;
      f.eventInstructions = e?.prep_instructions ?? null;
      f.calendarUrl = await calendarUrlForCalendar((d.luma_calendar as string) ?? null);
      const r = renderComms("day_of_guest", "guest", f);
      console.log(`\n--- SAMPLE (${claimed[0].guest_name}) ---`);
      console.log(`Subject: ${r?.subject}\n`);
      console.log(r?.text);
      console.log(`--- END SAMPLE ---\n`);
    }
  }

  if (!send) {
    console.log("DRY RUN — nothing sent. Re-run with --send to send for real.");
    return;
  }

  console.log("SENDING…");
  const sent = await sendDayOfGuestForEvent(eventId);
  console.log(`sendDayOfGuestForEvent processed ${sent} claimed guest(s) (email_log dedup applies).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
