/**
 * Manually send the pre-event prep email ("activate Notion AI") for one event.
 * The T-3 cron does this automatically; this is for testing / ad-hoc sends.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/send-prep.ts --event <event-id> [--dry-run]
 *   npm run send:prep -- --event <event-id> [--dry-run]
 */
import { listBookingsForEvent } from "../lib/db/bookings";
import { getEventById } from "../lib/db/events";
import { isEligibleForPrep, sendPrepForEvent } from "../lib/events/prep";

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

  const eligible = (await listBookingsForEvent(eventId)).filter(isEligibleForPrep);
  console.log(`Event: ${event.name} (${event.event_date})`);
  console.log(`Eligible guests: ${eligible.length}`);
  for (const b of eligible) console.log(`  - ${b.guest_name} <${b.guest_email}>`);

  if (dryRun) {
    console.log("\n[dry-run] no emails sent.");
    return;
  }
  const n = await sendPrepForEvent(eventId);
  console.log(`\nRequested prep emails for ${n} guest(s). (Dedup skips anyone already emailed.)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
