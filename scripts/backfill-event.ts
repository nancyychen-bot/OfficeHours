/**
 * Re-ingest every current Luma guest for an already-registered event.
 *
 * Luma doesn't resend webhooks, so when the registration form changes (e.g. a
 * renamed question) the existing bookings keep their stale parse. Re-running the
 * ingest pipeline re-normalizes each guest and re-pushes to Supabase + both
 * Notion workspaces. Idempotent (keyed on Luma guest id) and silent (no emails).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-event.ts --luma <evt-id-or-url>
 */
import { resolveLumaEventId, getLumaEvent } from "../lib/luma/client";
import { lumaCalendars } from "../lib/luma/calendars";
import { backfillEventGuests } from "../lib/events/backfill";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const lumaEvent = arg("--luma");
  if (!lumaEvent) {
    console.error("Required: --luma <evt-id-or-url>");
    process.exit(1);
  }

  const eventId = await resolveLumaEventId(lumaEvent);

  // Resolve the owning calendar's API key the same way registration does: the
  // host-only event endpoint only returns the event for the calendar that owns it.
  let apiKey = "";
  let calendarId = "";
  for (const cal of await lumaCalendars()) {
    try {
      await getLumaEvent(eventId, cal.apiKey);
      apiKey = cal.apiKey;
      calendarId = cal.id;
      break;
    } catch {
      // Not this calendar's event — try the next configured key.
    }
  }
  if (!apiKey) {
    console.error(`No connected calendar owns ${eventId}.`);
    process.exit(1);
  }

  console.log(`Backfilling ${eventId} (calendar: ${calendarId})…`);
  const result = await backfillEventGuests(eventId, apiKey);
  console.log(`  imported ${result.imported}, ignored ${result.ignored}, failed ${result.failed}`);
}

main().catch((err) => {
  console.error("backfill-event failed:", err);
  process.exit(1);
});
