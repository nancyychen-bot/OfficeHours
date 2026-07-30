import type { Json } from "../supabase/types";
import { getAdminClient } from "../supabase/admin";
import type { SyncDirection } from "./types";

export type SyncResult = "applied" | "skipped_echo" | "error";

/**
 * Append a row to `sync_log` — the audit trail the PRD leans on for debugging
 * the sync engine (§7.3 "one place to debounce echoes", §13 "resolve sync
 * issues"). Best-effort: logging must never break the actual sync path.
 */
export async function logSync(entry: {
  direction: SyncDirection;
  result: SyncResult;
  bookingId?: string | null;
  action?: string | null;
  payload?: Json | null;
  note?: string | null;
}): Promise<void> {
  try {
    const supabase = getAdminClient();
    await supabase.from("sync_log").insert({
      direction: entry.direction,
      result: entry.result,
      booking_id: entry.bookingId ?? null,
      action: entry.action ?? null,
      payload: entry.payload ?? null,
      note: entry.note ?? null,
    });
  } catch (err) {
    // Never let logging failures cascade into the sync path.
    console.error("[sync_log] failed to write audit row", err);
  }
}
