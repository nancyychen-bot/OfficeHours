import { getAdminClient } from "../supabase/admin";
import { listEvents } from "../db/events";
import { listEventGuests, statsFromGuests } from "../luma/client";
import { apiKeyForCalendar } from "../luma/calendars";
import { logSync } from "../sync/log";
import { syncInvitedGuestsForEvent } from "./invited-sync";

/**
 * Max events whose full Luma guest list one cron tick enumerates. Each event
 * costs N paginated `guests/list` calls (a 242-guest event ≈ 5), so refreshing
 * every event every 15 min is what rate-limited Luma into a 429 storm. Capping
 * per run (stalest synced first) bounds the call volume no matter how many
 * cities exist; each event still gets refreshed within a few ticks.
 */
export const LUMA_STATS_MAX_PER_RUN = 20;

/**
 * The events to refresh this tick: syncable ones (tracked, not cancelled),
 * stalest first (never-synced before least-recently-synced), capped. Pure so
 * the ordering/cap is unit-tested without touching Luma or the DB.
 */
export function selectStatsSyncBatch<
  T extends { status: string | null; luma_event_id: string | null; luma_synced_at: string | null },
>(events: T[], max = LUMA_STATS_MAX_PER_RUN): T[] {
  return events
    .filter((e) => e.status !== "cancelled" && !!e.luma_event_id)
    .sort((a, b) => (a.luma_synced_at ?? "").localeCompare(b.luma_synced_at ?? ""))
    .slice(0, max);
}

/** Fetch + persist Luma stats for one event (by luma_event_id). Best-effort. */
export async function syncLumaStatsForEvent(eventId: string, lumaEventId: string, apiKey: string): Promise<boolean> {
  try {
    const guests = await listEventGuests(lumaEventId, apiKey);
    const stats = statsFromGuests(guests);
    const supabase = getAdminClient();
    const { error } = await supabase
      .from("events")
      .update({ luma_stats: stats as unknown as Record<string, number | null>, luma_synced_at: new Date().toISOString() })
      .eq("id", eventId);
    if (error) throw error;
    // Pull host-invited guests into the hub (silent; mirrored to Notion). Reuses
    // the guest list already fetched for stats — no extra Luma calls.
    await syncInvitedGuestsForEvent(eventId, lumaEventId, guests);
    return true;
  } catch (err) {
    await logSync({
      direction: "luma_in",
      result: "error",
      action: "luma_stats_sync",
      note: `${lumaEventId}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return false;
  }
}

/** Refresh Luma stats for a bounded, stalest-first batch of tracked events. */
export async function syncAllLumaStats(): Promise<{ synced: number; failed: number }> {
  const events = selectStatsSyncBatch(await listEvents());
  let synced = 0;
  let failed = 0;
  for (const e of events) {
    if (!e.luma_event_id) continue;
    // Resolve the key defensively: an event tagged with a calendar whose
    // LUMA_API_KEY_<SUFFIX> isn't set (typo, staged rollout, retired calendar)
    // must degrade to one skipped event — not throw and abort the whole sweep
    // (which would freeze stats for every city that tick).
    let apiKey: string;
    try {
      apiKey = await apiKeyForCalendar(e.luma_calendar);
    } catch (err) {
      await logSync({
        direction: "luma_in",
        result: "error",
        action: "luma_stats_sync",
        note: `${e.luma_event_id}: ${err instanceof Error ? err.message : String(err)}`,
      });
      failed++;
      continue;
    }
    const ok = await syncLumaStatsForEvent(e.id, e.luma_event_id, apiKey);
    if (ok) synced++;
    else failed++;
  }
  return { synced, failed };
}
