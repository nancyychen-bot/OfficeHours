/**
 * Send SAMPLE renders of the pre-event prep emails (the ones asking guests to
 * complete the pre-event steps) to a test inbox, using the live published copy —
 * so you can eyeball exactly what guests receive. Sends nothing to real guests.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/send-prep-samples.ts [--to you@example.com]
 */
import { renderComms, SAMPLE_FIELDS, type CommsFields, type CommsKind } from "../lib/email/templates";
import { getLiveOverrideMap } from "../lib/db/email-overrides";
import { sendEmail } from "../lib/email/resend";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// The prep emails that ask guests to complete the pre-event steps.
const SAMPLES: Array<{ kind: CommsKind; label: string }> = [
  { kind: "prep_reminder", label: "Prep reminder (~3 days before)" },
  { kind: "prep_reminder_day_before", label: "Prep reminder — day before (Free plan)" },
  { kind: "prep_reminder_day_before_paid", label: "Prep reminder — day before (non-Free plan)" },
];

async function main() {
  const to = arg("--to") ?? "nchen@makenotion.com";
  const overrides = await getLiveOverrideMap();
  const f: CommsFields = { ...SAMPLE_FIELDS, guestEmail: to };

  for (const { kind, label } of SAMPLES) {
    const rendered = renderComms(kind, "guest", f, overrides);
    if (!rendered) throw new Error(`no template for ${kind}/guest`);

    console.log(`\n============ ${label} ============`);
    console.log(`Subject: ${rendered.subject}\n`);
    console.log(rendered.text);

    const { id } = await sendEmail({
      to,
      subject: `[SAMPLE] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
    });
    console.log(`\n✓ Sent to ${to} (resend id: ${id})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
