import { listEventGuests } from "../luma/client";
import { normalizeGuest } from "../luma/parse";
import { ingestRegistration } from "./ingest";
import { logSync } from "../sync/log";
import type { LumaGuestData } from "../luma/types";

export interface BackfillResult {
  imported: number;
  ignored: number;
  failed: number;
}

/**
 * Import every existing Luma guest for an event into the hub. Lets an organizer
 * register the event AFTER people have signed up — Luma doesn't resend webhooks
 * retroactively, so we pull the current guest list and run each through the same
 * ingest pipeline as the live webhook.
 *
 * Idempotent (keyed on the Luma guest id) and silent (no emails). Per-guest
 * failures are logged and skipped so one bad row can't abort the whole import.
 */
export async function backfillEventGuests(lumaEventId: string, apiKey: string): Promise<BackfillResult> {
  const guests = await listEventGuests(lumaEventId, apiKey);
  const result: BackfillResult = { imported: 0, ignored: 0, failed: 0 };

  for (const g of guests) {
    try {
      // The list entry has no nested `event`; supply the id we're backfilling.
      const norm = normalizeGuest({ ...g, event: { id: lumaEventId } } as LumaGuestData);
      const outcome = await ingestRegistration(norm, { live: false });
      if (outcome.status === "ingested") result.imported++;
      else result.ignored++;
    } catch (err) {
      result.failed++;
      await logSync({
        direction: "luma_in",
        result: "error",
        action: "backfill",
        note: `guest ${g.id}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return result;
}
