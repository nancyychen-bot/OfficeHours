/**
 * Snapshot the hub's Supabase tables to local JSON (a manual safety net before
 * any reset, and an offsite copy of the data). Writes to backups/<timestamp>/.
 *
 * Usage: npx tsx --env-file=.env.local scripts/backup-db.ts
 *        npm run backup
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAdminClient } from "../lib/supabase/admin";

const TABLES = ["events", "slots", "bookings", "feedback_mirror", "email_log", "sync_log"];

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(process.cwd(), "backups", stamp);
  mkdirSync(dir, { recursive: true });

  const summary: Record<string, number> = {};
  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      console.error(`[${table}] ERROR: ${error.message}`);
      continue;
    }
    writeFileSync(join(dir, `${table}.json`), JSON.stringify(data ?? [], null, 2));
    summary[table] = (data ?? []).length;
    console.log(`[${table}] ${summary[table]} rows`);
  }
  writeFileSync(join(dir, "_summary.json"), JSON.stringify({ stamp, summary }, null, 2));
  console.log(`\nBackup written to backups/${stamp}/`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
