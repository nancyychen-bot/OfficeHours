/**
 * Email a rendered PREVIEW of every comms template to one address, so the copy can
 * be eyeballed in a real inbox before going live. Renders each TemplateKey in
 * TEMPLATE_REGISTRY with representative sample data, reflecting any PUBLISHED DB
 * overrides (so you see what actually sends). Touches no bookings; sends via the
 * low-level sender, so it ignores the COMMS_ENABLED kill-switch (a preview always
 * sends). Subjects are prefixed `[PREVIEW i/N] <key> ::` so they're easy to scan.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/preview-comms.ts [--to you@x.com] [--dry] [--only <substr>]
 */
import { TEMPLATE_REGISTRY, buildVars, renderTemplate, type CommsFields, type TemplateKey, type TemplateDef, type OverrideMap } from "../lib/email/templates";
import { sendEmail } from "../lib/email/resend";
import { getLiveOverrideMap } from "../lib/db/email-overrides";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// Representative values so every placeholder resolves to something readable.
const SAMPLE: CommsFields = {
  bookingId: "preview",
  guestName: "Sam Rivera",
  guestEmail: "sam@example.com",
  company: "Acme Inc",
  role: "Product Manager",
  challenge: "Automating my team's project tracker",
  guestPhone: "+1 555 0100",
  slotName: "2:30–2:50 PM",
  slotStartsAt: "2026-10-22T14:30:00+08:00",
  slotEndsAt: "2026-10-22T14:50:00+08:00",
  eventName: "Notion Build Bar Singapore",
  eventDate: "2026-10-22",
  location: "Singapore",
  address: "123 Example St, Singapore",
  helperName: "Jordan Lee",
  helperEmail: "jordan@example.com",
  status: "assigned",
  slotId: "slot-preview",
  calendarUrl: null,
  eventUrl: "https://lu.ma/notion-build-bar-singapore",
  eventInstructions: "Check in at the 5th-floor reception and ask for the Notion Build Bar.",
} as CommsFields;

async function main() {
  const to = arg("--to") ?? process.env.TEST_EMAIL ?? "nancy.y.chen@gmail.com";
  const dry = process.argv.includes("--dry");
  const only = arg("--only");

  let overrides: OverrideMap = new Map();
  try {
    overrides = await getLiveOverrideMap();
  } catch (e) {
    console.warn(`(couldn't load DB overrides, using built-in defaults): ${e instanceof Error ? e.message : e}`);
  }

  let keys = Object.keys(TEMPLATE_REGISTRY).sort() as TemplateKey[];
  if (only) keys = keys.filter((k) => k.includes(only));

  console.log(`Previewing ${keys.length} templates → ${to}${dry ? "  [dry-run]" : ""}\n`);

  let i = 0;
  for (const key of keys) {
    i++;
    const def: TemplateDef = TEMPLATE_REGISTRY[key];
    const ov = overrides.get(key);
    const content = {
      subject: ov?.subject ?? def.subject,
      body: ov?.body ?? def.body,
    };
    const vars = buildVars(def.role, SAMPLE);
    // day_of_agenda uses a {{agenda}} block built elsewhere; give it a sample here.
    vars.agenda = "• 2:30–2:50 PM — Sam Rivera (Acme Inc) — Automating my team's project tracker\n• 3:00–3:20 PM — Priya N. — Dashboards";
    const r = renderTemplate(content, vars);
    const subject = `[PREVIEW ${i}/${keys.length}] ${key}${ov ? " (LIVE override)" : ""} :: ${r.subject}`;

    if (dry) {
      console.log(`${i}. ${key}${ov ? " (override)" : ""}  →  ${r.subject}`);
      continue;
    }
    try {
      const { id } = await sendEmail({ to, subject, html: r.html, text: r.text });
      console.log(`${i}. sent ${key}${ov ? " (override)" : ""}  [${id}]`);
    } catch (e) {
      console.error(`${i}. FAILED ${key}: ${e instanceof Error ? e.message : e}`);
    }
    // Stay under Resend's 10 req/sec limit (~5/sec here).
    await new Promise((res) => setTimeout(res, 200));
  }
  console.log(`\nDone. Check ${to}.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
