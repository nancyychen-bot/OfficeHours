/**
 * Teardown for the invited-guest completion test. Removes ONLY the throwaway row
 * seeded by scripts/test-completion-flow.ts (matched on its `TEST-complete-reg-…`
 * luma_guest_id): archives the Notion mirror pages, deletes the email_log rows,
 * then deletes the booking. Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/test-completion-teardown.ts [--event <event-id>]
 */
import { getAdminClient } from "../lib/supabase/admin";
import { getEventById } from "../lib/db/events";
import { getBookingByLumaGuestId } from "../lib/db/bookings";
import { getNotionClient, type NotionWorkspace } from "../lib/notion/client";

const DEFAULT_EVENT_ID = "2375b356-9309-4b13-b349-759360258b5d"; // Notion Build Bar Singapore

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const eventId = arg("--event") ?? DEFAULT_EVENT_ID;
  const event = await getEventById(eventId);
  if (!event?.luma_event_id) { console.error(`No event / luma_event_id for ${eventId}`); process.exit(1); }

  const lumaGuestId = `TEST-complete-reg-${event.luma_event_id}`;
  const booking = await getBookingByLumaGuestId(lumaGuestId);
  if (!booking) { console.log(`Nothing to tear down (no booking ${lumaGuestId}).`); return; }

  // Hard guard: only ever delete the tagged test row.
  if (!booking.luma_guest_id?.startsWith("TEST-complete-reg-")) {
    console.error(`Refusing: booking ${booking.id} is not a TEST- row.`); process.exit(1);
  }

  const supabase = getAdminClient();

  // 1. Archive the Notion mirror pages (best-effort).
  const pages: Array<[NotionWorkspace, string | null]> = [
    ["dev", booking.notion_dev_page_id],
    ["ambassador", booking.notion_ambassador_page_id],
  ];
  for (const [workspace, pageId] of pages) {
    if (!pageId) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await getNotionClient(workspace).pages.update({ page_id: pageId, archived: true } as any);
      console.log(`Archived ${workspace} Notion page ${pageId}`);
    } catch (e) {
      console.warn(`Could not archive ${workspace} page ${pageId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 2. Delete email_log rows, then the booking.
  const { error: elErr } = await supabase.from("email_log").delete().eq("booking_id", booking.id);
  if (elErr) console.warn(`email_log delete: ${elErr.message}`);
  const { error: bErr } = await supabase.from("bookings").delete().eq("id", booking.id);
  if (bErr) { console.error(`booking delete failed: ${bErr.message}`); process.exit(1); }

  console.log(`\nTore down test booking ${booking.id} (${lumaGuestId}). Done.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
