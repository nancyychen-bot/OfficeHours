/**
 * Test harness for the invited-guest completion flow (local dev, real DB).
 *
 * Seeds ONE throwaway "invited guest" booking (zero answers, approved) on a REAL
 * event — tagged with a `TEST-complete-reg-…` luma_guest_id so it's trivially
 * identifiable and reversible — then mints the magic-link token and prints the
 * local form URL. Real guests are never touched; `scripts/test-completion-teardown.ts`
 * removes everything this creates.
 *
 * The form submit runs ingest({ live:false }), so it emails NO ONE. Pass --send-email
 * to additionally fire the completion email itself (to the test address) so you can
 * eyeball the copy — gated by COMMS_ENABLED like every other send.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/test-completion-flow.ts [--event <event-id>] [--email you@x.com] [--send-email]
 *
 * Defaults: Notion Build Bar Singapore (evt-WCXl3pOH3lRap1F), email from $TEST_EMAIL
 * or nancy.y.chen@gmail.com.
 */
import { getEventById } from "../lib/db/events";
import { upsertBookingFromLuma, getBookingByLumaGuestId } from "../lib/db/bookings";
import { issueBookingToken } from "../lib/auth/booking-token";
import { env } from "../lib/env";

const DEFAULT_EVENT_ID = "2375b356-9309-4b13-b349-759360258b5d"; // Notion Build Bar Singapore

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const eventId = arg("--event") ?? DEFAULT_EVENT_ID;
  const email = arg("--email") ?? process.env.TEST_EMAIL ?? "nancy.y.chen@gmail.com";
  const sendEmail = process.argv.includes("--send-email");

  const event = await getEventById(eventId);
  if (!event) { console.error(`No event ${eventId}`); process.exit(1); }
  if (!event.luma_event_id) { console.error(`Event ${eventId} has no luma_event_id`); process.exit(1); }

  // Stable, obviously-fake guest id → rerunning updates the same test row (idempotent).
  const lumaGuestId = `TEST-complete-reg-${event.luma_event_id}`;

  // Seed an invited guest: zero answers, approved. isInvitedGuest(norm) is true for this.
  const booking = await upsertBookingFromLuma({
    lumaGuestId,
    eventId: event.id,
    slotId: null,
    guestName: "TEST Invited Guest",
    guestEmail: email,
    lumaStatus: "approved",
  });

  const token = await issueBookingToken(booking.id, env.hub.sessionSecret(), Date.now());
  const url = `http://localhost:3000/complete-registration/${token}`;

  console.log("\n=== invited-guest completion test seeded ===");
  console.log(`Event:        ${event.name} (${event.event_date}) · ${event.luma_event_id}`);
  console.log(`Test booking: ${booking.id}`);
  console.log(`Guest id:     ${lumaGuestId}`);
  console.log(`Test email:   ${email}`);
  console.log(`Status:       ${booking.status}  luma_status=${booking.luma_status}`);
  console.log("\n1. Start the app:   npm run dev");
  console.log("2. Open the form:");
  console.log(`\n   ${url}\n`);
  console.log("3. Fill it in and submit. Then verify (prod DB):");
  console.log(`   select guest_name, status, challenge, requested_slot, slot_id, last_synced_at`);
  console.log(`   from bookings where id = '${booking.id}';`);
  console.log("\n4. Tear it all down when done:");
  console.log(`   npx tsx --env-file=.env.local scripts/test-completion-teardown.ts --event ${event.id}`);

  if (sendEmail) {
    const { sendBookingComms } = await import("../lib/email/comms");
    console.log(`\n[--send-email] sending the completion email to ${email} (COMMS_ENABLED=${process.env.COMMS_ENABLED ?? "unset→on"})…`);
    await sendBookingComms(booking.id, "complete_registration");
    console.log("Sent (best-effort). Check the inbox + the email_log row for this booking.");
    console.log("Note: the emailed link points at APP_BASE_URL, not localhost.");
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
