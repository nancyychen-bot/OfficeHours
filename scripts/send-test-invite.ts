/**
 * Send a REAL claim invite (the exact `assigned` email guests/experts receive,
 * with published copy overrides + the METHOD:PUBLISH .ics) to a test inbox, so
 * you can eyeball the copy and confirm accepting doesn't bounce.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/send-test-invite.ts [--to you@example.com] [--role guest|helper|both]
 */
import { buildInvite, inviteAttachment, fromAddressEmail } from "../lib/email/ics";
import { renderComms, inviteDescription, SAMPLE_FIELDS, type CommsFields, type Recipient } from "../lib/email/templates";
import { getLiveOverrideMap } from "../lib/db/email-overrides";
import { sendEmail } from "../lib/email/resend";
import { env } from "../lib/env";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function sendOne(role: Recipient, to: string, f: CommsFields, overrides: Awaited<ReturnType<typeof getLiveOverrideMap>>) {
  const rendered = renderComms("assigned", role, f, overrides);
  if (!rendered) throw new Error(`no template for assigned/${role}`);

  const summary = role === "helper"
    ? `Notion Build Bar - Meet ${f.guestName}`
    : `Notion Build Bar - Meet ${f.helperName ?? "your Notion expert"}`;
  const ics = buildInvite(
    { bookingId: f.bookingId, guestName: f.guestName, guestEmail: f.guestEmail, helperEmail: f.helperEmail, helperName: f.helperName, slotStartsAt: f.slotStartsAt, slotEndsAt: f.slotEndsAt, location: f.address ?? f.location, descriptionText: inviteDescription(f), summary },
    fromAddressEmail(env.comms.from()),
    new Date().toISOString(),
  );
  const attachment = ics ? inviteAttachment(ics, "PUBLISH") : undefined;

  console.log(`\n============ assigned / ${role} ============`);
  console.log(`Subject: ${rendered.subject}\n`);
  console.log(rendered.text);
  console.log(`\n[calendar attachment: ${attachment ? "invite.ics (METHOD:PUBLISH)" : "none"}]`);

  const { id } = await sendEmail({ to, subject: rendered.subject, html: rendered.html, text: rendered.text, attachments: attachment ? [attachment] : undefined });
  console.log(`✓ Sent to ${to} (resend id: ${id})`);
}

async function main() {
  const to = arg("--to") ?? "nchen@makenotion.com";
  const roleArg = (arg("--role") ?? "guest") as "guest" | "helper" | "both";
  const overrides = await getLiveOverrideMap();

  // A representative booking, addressed to the test inbox.
  const f: CommsFields = { ...SAMPLE_FIELDS, guestEmail: to, helperEmail: to };

  const roles: Recipient[] = roleArg === "both" ? ["guest", "helper"] : [roleArg];
  for (const role of roles) await sendOne(role, to, f, overrides);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
