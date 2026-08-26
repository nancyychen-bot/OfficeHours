/**
 * One-off "come 10 min early + bring your laptop" email to every APPROVED guest
 * of an event (both 1:1 and cowork). Not a comms template — inline content via
 * renderTemplate. Idempotent: records a `sent` email_log row per recipient and
 * skips anyone already sent (safe to re-run after a partial failure).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/send-arrive-early.ts --event <event-id> [--dry-run]
 */
import { getAdminClient } from "../lib/supabase/admin";
import { renderTemplate } from "../lib/email/templates";
import { sendEmail } from "../lib/email/resend";

const KIND = "arrive_early";
const SUBJECT = "See you today at Notion Build Bar — two quick things ✨";
const BODY = [
  "Hi {{firstName}},", "",
  "Notion Build Bar is **today** — we can't wait to build with you!", "",
  "Two quick things before you head over:", "",
  "✅ **Arrive 10 minutes early** so we can get you checked in and settled",
  "✅ **Bring your laptop** (plus the question or workspace you want help with)", "",
  "See you soon,",
  "The Notion Community Team", "",
  "*If you have any questions please email communityevents@makenotion.com*",
].join("\n");

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;

  const { data: rows } = await supabase
    .from("bookings")
    .select("id, guest_name, guest_email, filtered")
    .eq("event_id", eventId)
    .eq("luma_status", "approved")
    .neq("status", "cancelled")
    .not("guest_email", "is", null);
  const recips = (rows ?? []).filter((r: any) => !r.filtered);

  const ids = recips.map((r: any) => r.id);
  const { data: sentRows } = await supabase
    .from("email_log")
    .select("booking_id")
    .eq("event_kind", KIND)
    .eq("status", "sent")
    .in("booking_id", ids.length ? ids : ["-"]);
  const already = new Set((sentRows ?? []).map((r: any) => r.booking_id));
  const todo = recips.filter((r: any) => !already.has(r.id));

  console.log(`Approved recipients: ${recips.length} | already sent: ${already.size} | to send: ${todo.length}`);

  if (dryRun) {
    const s = renderTemplate({ subject: SUBJECT, body: BODY }, { firstName: "Glenelys" });
    console.log(`\n[dry-run] sample render —\nSUBJECT: ${s.subject}\n\n${s.text}`);
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const r of todo) {
    const firstName = (r.guest_name ?? "").trim().split(/\s+/)[0] || "there";
    const { subject, html, text } = renderTemplate({ subject: SUBJECT, body: BODY }, { firstName });
    try {
      const { id } = await sendEmail({ to: r.guest_email, subject, html, text });
      await supabase.from("email_log").insert({
        booking_id: r.id, event_kind: KIND, recipient_role: "guest",
        recipient_email: r.guest_email, resend_id: id, status: "sent",
      });
      sent++;
    } catch (e) {
      failed++;
      console.error(`  fail ${r.guest_email}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\nSent ${sent}, failed ${failed}. (Re-run to retry any failures.)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
