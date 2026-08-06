/**
 * Manually refresh Luma per-event stats (the cron does this every 15 min).
 * Usage: npx tsx --env-file=.env.local scripts/sync-luma-stats.ts
 */
import { syncAllLumaStats } from "../lib/events/luma-stats";

async function main() {
  const { synced, failed } = await syncAllLumaStats();
  console.log(`Luma stats synced=${synced} failed=${failed}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
