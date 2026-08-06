import { getAdminClient } from "../supabase/admin";
import { getNotionClient, bookingsDataSourceId, type NotionWorkspace } from "../notion/client";
import { pushBookingToWorkspaces } from "../notion/push";
import type { Booking } from "../sync/types";
import type { Snapshot } from "./snapshot";

// Restored in FK-safe order. Logs (email_log, sync_log) are history — not restored.
// feedback_mirror is keyed on ambassador_page_id, everything else on id.
const RESTORE_TABLES: { table: string; pk: string }[] = [
  { table: "events", pk: "id" },
  { table: "slots", pk: "id" },
  { table: "bookings", pk: "id" },
  { table: "feedback_mirror", pk: "ambassador_page_id" },
];

/** Pure: snapshot rows whose primary key isn't already present in the DB. */
export function missingRows<T extends Record<string, unknown>>(
  snapshotRows: T[],
  existingKeys: Set<unknown>,
  pk: string,
): T[] {
  return snapshotRows.filter((r) => !existingKeys.has(r[pk]));
}

/** Pure: Notion page ids present in Notion but referenced by no booking. */
export function findOrphans(notionIds: string[], referencedIds: Set<string>): string[] {
  return notionIds.filter((id) => !referencedIds.has(id));
}

export interface RestoreReport {
  added: Record<string, number>;
  notion: { recreated: number; updated: number };
  orphans: { dev: string[]; ambassador: string[] } | null;
}

/**
 * MERGE-ONLY restore: insert rows from the snapshot that are missing now (matched
 * by primary key), never deleting or overwriting current data — so newer signups
 * are always safe. Then re-push every booking so Notion mirrors are corrected
 * (deleted cards recreated), and flag (never delete) any orphan Notion cards.
 */
export async function restoreFromSnapshot(snapshot: Snapshot): Promise<RestoreReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const added: Record<string, number> = {};

  // 1) Insert-missing, FK-safe order.
  for (const { table, pk } of RESTORE_TABLES) {
    const rows = (snapshot.tables[table] ?? []) as Record<string, unknown>[];
    if (!rows.length) { added[table] = 0; continue; }
    const { data: existing } = await supabase.from(table).select(pk);
    const existingKeys = new Set((existing ?? []).map((r: Record<string, unknown>) => r[pk]));
    const toInsert = missingRows(rows, existingKeys, pk);
    if (toInsert.length) {
      const { error } = await supabase.from(table).insert(toInsert);
      if (error) throw new Error(`restore ${table}: ${error.message}`);
    }
    added[table] = toInsert.length;
  }

  // 2) Re-push every booking → recreate deleted cards, correct existing ones.
  const notion = { recreated: 0, updated: 0 };
  const { data: events } = await supabase.from("events").select("id, name, city, event_date");
  const { data: slots } = await supabase.from("slots").select("id, name");
  const eventMap = new Map((events ?? []).map((e: Record<string, unknown>) => [e.id, e]));
  const slotMap = new Map((slots ?? []).map((s: Record<string, unknown>) => [s.id, s.name]));
  const { data: bookings } = await supabase.from("bookings").select("*");
  for (const b of (bookings ?? []) as Booking[]) {
    const ev = eventMap.get(b.event_id) as { name?: string; city?: string; event_date?: string } | undefined;
    const opts = {
      slotLabel: b.slot_id ? (slotMap.get(b.slot_id) as string | undefined) : undefined,
      location: ev?.city,
      eventName: ev?.name,
      eventDate: ev?.event_date,
    };
    const res = await pushBookingToWorkspaces(b, { fullUpdate: true, dev: opts, ambassador: opts });
    for (const ws of ["dev", "ambassador"] as const) {
      if (res[ws] === "created") notion.recreated++;
      else if (res[ws] === "updated") notion.updated++;
    }
  }

  // 3) Orphan scan (best-effort — never deletes; just reports).
  let orphans: RestoreReport["orphans"] = null;
  try {
    const { data: refs } = await supabase.from("bookings").select("notion_dev_page_id, notion_ambassador_page_id");
    const refDev = new Set((refs ?? []).map((r: Record<string, unknown>) => r.notion_dev_page_id).filter(Boolean) as string[]);
    const refAmb = new Set((refs ?? []).map((r: Record<string, unknown>) => r.notion_ambassador_page_id).filter(Boolean) as string[]);
    orphans = {
      dev: findOrphans(await listAllCardIds("dev"), refDev),
      ambassador: findOrphans(await listAllCardIds("ambassador"), refAmb),
    };
  } catch {
    orphans = null; // scan is best-effort; don't fail the restore over it
  }

  return { added, notion, orphans };
}

/** Every (live) card id in a workspace's bookings data source, paginated. */
async function listAllCardIds(ws: NotionWorkspace): Promise<string[]> {
  const notion = getNotionClient(ws);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await (notion as any).dataSources.query({
      data_source_id: bookingsDataSourceId(ws),
      start_cursor: cursor,
      page_size: 100,
    })) as { results?: Array<{ id: string; archived?: boolean; in_trash?: boolean }>; has_more?: boolean; next_cursor?: string };
    for (const p of res.results ?? []) {
      if (!p.archived && !p.in_trash) ids.push(p.id);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return ids;
}
