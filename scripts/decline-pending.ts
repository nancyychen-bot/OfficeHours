/**
 * Manually decline every still-pending guest for one event — the same sweep the
 * day-before cron runs, but on demand and without a serverless time limit (so it
 * always drains the full list, however large). Sends the "declined" email, writes
 * declined back to Luma, and mirrors Declined to both Notion DBs. Idempotent.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/decline-pending.ts --event <event-id> [--dry-run]
 *   npm run decline:pending -- --event <event-id> [--dry-run]
 */
import { listBookingsForEvent } from "../lib/db/bookings";
import { getEventById } from "../lib/db/events";
import { declinePendingForEvent, selectDeclinablePendings } from "../lib/events/decline-pending";

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

  const pendings = selectDeclinablePendings(await listBookingsForEvent(eventId));
  console.log(`Event: ${event.name} (${event.event_date})`);
  console.log(`Still-pending guests: ${pendings.length}`);
  for (const b of pendings) console.log(`  - ${b.guest_name} <${b.guest_email ?? "no-email"}>`);

  if (dryRun) {
    console.log("\n[dry-run] no one declined, no emails sent.");
    return;
  }
  const n = await declinePendingForEvent(eventId);
  console.log(`\nDeclined ${n} guest(s). (Best-effort; re-run to pick up any that errored.)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
