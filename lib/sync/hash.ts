import { createHash } from "node:crypto";
import type { SyncedFields } from "./types";

/**
 * Loop prevention (PRD §7.3).
 *
 * The hub stamps `bookings.last_synced_hash` on every write it pushes to a
 * Notion workspace. When an automation webhook arrives from Notion, we hash the
 * incoming synced fields and compare: if it equals the stored hash, the webhook
 * is an ECHO of our own write, not a human change — so we drop it instead of
 * propagating it onward (which is what causes Dev→hub→Amb→hub→Dev storms).
 */
export function hashSyncedFields(fields: SyncedFields): string {
  // Canonical, key-ordered serialization so equal states always hash equally.
  const canonical = JSON.stringify({
    status: fields.status,
    luma_status: fields.luma_status,
    booked_by_display_name: fields.booked_by_display_name ?? null,
    booked_by_type: fields.booked_by_type ?? null,
    filtered: fields.filtered ?? false,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * True when `incoming` matches what the hub last synced for this booking —
 * i.e. the webhook is an echo and should be ignored.
 */
export function isEcho(incoming: SyncedFields, lastSyncedHash: string | null): boolean {
  if (!lastSyncedHash) return false;
  return hashSyncedFields(incoming) === lastSyncedHash;
}
