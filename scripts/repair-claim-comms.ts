/**
 * Repair a claim whose DB assignment committed but whose side-effects (comms /
 * Slack) never ran — e.g. the handler hit the 30s Vercel function timeout after
 * `claimBooking` but before `sendBookingComms`. Because the booking is already
 * `assigned`, the Notion re-fire webhooks only ever `noop`, so the comms can
 * never self-heal. This re-drives the exact tail of the claim block.
 *
 * Idempotent: `sendBookingComms` dedups on email_log; Slack posts are best-effort.
 * Does NOT touch Luma (approval axis is owned by Luma's own guest.updated sync).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/repair-claim-comms.ts --booking <id>            # dry-run
 *   npx tsx --env-file=.env.local scripts/repair-claim-comms.ts --booking <id> --send     # actually send
 */
import { getBookingById } from "../lib/db/bookings";
import { clearCommsForKinds } from "../lib/db/email-log";
import { sendBookingComms } from "../lib/email/comms";
import { postClaimConfirmDM } from "../lib/slack/notify";
import { postSlackClaimed } from "../lib/slack/client";
import { logSync } from "../lib/sync/log";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const bookingId = arg("--booking");
  const send = process.argv.includes("--send");
  if (!bookingId) {
    console.error("Missing --booking <id>");
    process.exit(1);
  }

  const b = await getBookingById(bookingId);
  if (!b) {
    console.error(`No booking ${bookingId}`);
    process.exit(1);
  }

  console.log(`Booking:      ${b.guest_name} <${b.guest_email}>`);
  console.log(`Status:       ${b.status}   luma_status: ${b.luma_status}`);
  console.log(`Claimed by:   ${b.booked_by_display_name ?? "—"} <${b.booked_by_email ?? "—"}> (${b.booked_by_type ?? "—"})`);

  // Guard: only repair a live, claimed booking. Never re-send for a released /
  // cancelled / unclaimed one.
  if (b.status !== "assigned" || !b.booked_by_email) {
    console.error(`\nRefusing: booking is not an assigned+emailed claim (status=${b.status}, email=${b.booked_by_email ?? "none"}).`);
    process.exit(1);
  }

  console.log(`\nWill re-drive the claim side-effects:`);
  console.log(`  1. sendBookingComms("assigned")  → "assigned" email + .ics to guest (${b.guest_email}) and expert (${b.booked_by_email})`);
  console.log(`  2. postClaimConfirmDM             → Slack DM to expert (${b.booked_by_email})`);
  console.log(`  3. postSlackClaimed              → recruit-channel "covered" note (no-op unless recruited)`);

  if (!send) {
    console.log(`\n[dry-run] nothing sent. Re-run with --send to fire.`);
    return;
  }

  // Fresh assignment: clear any prior 'assigned' send so the dedup can't suppress
  // the re-send (mirrors the claim block).
  await clearCommsForKinds(b.id, ["assigned"]);
  await sendBookingComms(b.id, "assigned");
  await postClaimConfirmDM(b.id);
  await postSlackClaimed(b.id);
  await logSync({ direction: "luma_in", result: "applied", bookingId: b.id, action: "claim_comms_repaired" });
  console.log(`\n✓ Sent. Check email_log + Slack.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
