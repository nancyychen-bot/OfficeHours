/**
 * Snapshot the hub's Supabase tables to local JSON (a manual safety net before
 * any reset). The daily off-site copy is /api/cron/backup → Vercel Blob.
 *
 * Usage: npm run backup
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildSnapshot } from "../lib/backup/snapshot";

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshot = await buildSnapshot(stamp);
  const dir = join(process.cwd(), "backups", stamp);
  mkdirSync(dir, { recursive: true });
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    writeFileSync(join(dir, `${table}.json`), JSON.stringify(rows, null, 2));
    console.log(`[${table}] ${rows.length} rows`);
  }
  writeFileSync(join(dir, "_summary.json"), JSON.stringify({ stamp, summary: snapshot.summary }, null, 2));
  console.log(`\nBackup written to backups/${stamp}/`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
