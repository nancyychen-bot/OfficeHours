/**
 * Send the post-event feedback email to every guest who CHECKED IN at an event.
 * Idempotent (email_log dedup on booking+kind+email), so re-running is safe.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/send-feedback.ts --event <event-id> [--dry-run]
 *   npm run send:feedback -- --event <event-id> [--dry-run]
 */
import { listBookingsForEvent } from "../lib/db/bookings";
import { getEventById } from "../lib/db/events";
import { sendBookingComms } from "../lib/email/comms";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const eventId = arg("--event");
  const dryRun = process.argv.includes("--dry-run");
  if (!eventId) {
    console.error("Missing --event <event-id>");
    process.exit(1);
  }

  const event = await getEventById(eventId);
  if (!event) {
    console.error(`No event ${eventId}`);
    process.exit(1);
  }

  const bookings = await listBookingsForEvent(eventId);
  const checkedIn = bookings.filter((b) => b.status === "checked_in" && b.guest_email);
  console.log(`Event: ${event.name} (${event.event_date})`);
  console.log(`Checked-in guests: ${checkedIn.length}`);
  for (const b of checkedIn) console.log(`  - ${b.guest_name} <${b.guest_email}>`);

  if (dryRun) {
    console.log("\n[dry-run] no emails sent.");
    return;
  }

  let sent = 0;
  for (const b of checkedIn) {
    await sendBookingComms(b.id, "feedback_request");
    sent++;
  }
  console.log(`\nRequested feedback emails for ${sent} guest(s). (Dedup skips anyone already emailed.)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
