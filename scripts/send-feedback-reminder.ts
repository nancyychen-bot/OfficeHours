/**
 * Manually send the post-event feedback REMINDER to checked-in guests of an event
 * who haven't responded yet ("we'd still love to hear from you"). Same copy and
 * skip logic as the automated 2-day cron — uses the editable `feedback_reminder`
 * template and is idempotent (email_log dedup on booking+kind+email), so re-running
 * is safe and won't email anyone twice.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/send-feedback-reminder.ts --event <event-id> [--dry-run]
 *   npm run send:feedback-reminder -- --event <event-id> [--dry-run]
 */
import { getEventById } from "../lib/db/events";
import { listBookingsForEvent } from "../lib/db/bookings";
import { listFeedbackRespondentEmails } from "../lib/db/feedback";
import { isEligibleForFeedbackReminder, sendFeedbackReminderForEvent } from "../lib/events/feedback";

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

  const responded = await listFeedbackRespondentEmails({ id: event.id, eventDate: event.event_date });
  const todo = (await listBookingsForEvent(eventId)).filter((b) => isEligibleForFeedbackReminder(b, responded));
  console.log(`Event: ${event.name} (${event.event_date})`);
  console.log(`Checked-in non-responders: ${todo.length} (responders skipped: ${responded.size})`);
  for (const b of todo) console.log(`  - ${b.guest_name} <${b.guest_email}>`);

  if (dryRun) {
    console.log("\n[dry-run] no emails sent.");
    return;
  }

  const sent = await sendFeedbackReminderForEvent(eventId);
  console.log(`\nRequested feedback reminders for ${sent} guest(s). (Dedup skips anyone already reminded.)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
