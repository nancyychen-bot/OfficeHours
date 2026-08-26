import { getAdminClient } from "../supabase/admin";
import { listEvents } from "../db/events";
import { fetchEventStats } from "../luma/client";
import { apiKeyForCalendar } from "../luma/calendars";
import { logSync } from "../sync/log";

/** Fetch + persist Luma stats for one event (by luma_event_id). Best-effort. */
export async function syncLumaStatsForEvent(eventId: string, lumaEventId: string, apiKey: string): Promise<boolean> {
  try {
    const stats = await fetchEventStats(lumaEventId, apiKey);
    const supabase = getAdminClient();
    const { error } = await supabase
      .from("events")
      .update({ luma_stats: stats as unknown as Record<string, number | null>, luma_synced_at: new Date().toISOString() })
      .eq("id", eventId);
    if (error) throw error;
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

/** Refresh Luma stats for every non-cancelled tracked event. */
export async function syncAllLumaStats(): Promise<{ synced: number; failed: number }> {
  const events = (await listEvents()).filter((e) => e.status !== "cancelled" && e.luma_event_id);
  let synced = 0;
  let failed = 0;
  for (const e of events) {
    if (!e.luma_event_id) continue;
    const ok = await syncLumaStatsForEvent(e.id, e.luma_event_id, apiKeyForCalendar(e.luma_calendar));
    if (ok) synced++;
    else failed++;
  }
  return { synced, failed };
}
