/**
 * Backfill the cowork-only notice for one event's already-approved guests
 * (approved + no slot + asked for "1:1 help"). Going forward this sends
 * automatically on approval; this is for the initial backfill / ad-hoc sends.
 *
 * Usage:
 *   # test: send ONE real rendered copy to yourself, touching no real guests
 *   npm run send:cowork -- --event <event-id> --test you@example.com
 *   # dry run: list who would receive it
 *   npm run send:cowork -- --event <event-id> --dry-run
 *   # real: send to all qualifying guests (dedup-safe)
 *   npm run send:cowork -- --event <event-id>
 */
import { listBookingsForEvent } from "../lib/db/bookings";
import { getEventById } from "../lib/db/events";
import {
  selectCoworkOnlyBackfill,
  sendCoworkNoticeForEvent,
  sendCoworkNoticeTest,
} from "../lib/events/cowork-notice";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const eventId = arg("--event");
  const testEmail = arg("--test");
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

  const eligible = selectCoworkOnlyBackfill(await listBookingsForEvent(eventId));
  console.log(`Event: ${event.name} (${event.event_date})`);
  console.log(`Qualifying guests: ${eligible.length}`);
  for (const b of eligible) console.log(`  - ${b.guest_name} <${b.guest_email}>`);

  if (testEmail) {
    const sampleId = await sendCoworkNoticeTest(eventId, testEmail);
    console.log(
      sampleId
        ? `\n[test] sent one sample copy (booking ${sampleId}) to ${testEmail}. No real guests emailed.`
        : `\n[test] no qualifying guest to sample from.`,
    );
    return;
  }
  if (dryRun) {
    console.log("\n[dry-run] no emails sent.");
    return;
  }
  const n = await sendCoworkNoticeForEvent(eventId);
  console.log(`\nRequested cowork-only notices for ${n} guest(s). (Dedup skips anyone already emailed.)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
