import { getAdminClient } from "../supabase/admin";

export const BACKUP_TABLES = ["events", "slots", "bookings", "feedback_mirror", "email_log", "sync_log"] as const;

export interface Snapshot {
  stamp: string;
  tables: Record<string, unknown[]>;
  summary: Record<string, number>;
}

/** Read every hub table into an in-memory snapshot (used by the script + cron). */
export async function buildSnapshot(stampISO: string): Promise<Snapshot> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const tables: Record<string, unknown[]> = {};
  const summary: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    const { data, error } = await supabase.from(t).select("*");
    if (error) throw new Error(`backup ${t}: ${error.message}`);
    tables[t] = data ?? [];
    summary[t] = (data ?? []).length;
  }
  return { stamp: stampISO, tables, summary };
}
