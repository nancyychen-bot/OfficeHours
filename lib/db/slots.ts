import { getAdminClient } from "../supabase/admin";
import type { SlotRow } from "../sync/types";

export async function getSlotById(id: string): Promise<SlotRow | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("slots")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listSlotsForEvent(eventId: string): Promise<SlotRow[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("slots")
    .select("*")
    .eq("event_id", eventId)
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Pure slot matcher (unit-tested). Given a set of slots and what the guest
 * requested, pick the matching slot: exact start-time match wins, else a
 * case-insensitive label match against the slot name (e.g. "2:00–2:30 PM").
 */
export function selectMatchingSlot(
  slots: SlotRow[],
  requested: { label?: string | null; startsAt?: string | null },
): SlotRow | null {
  if (requested.startsAt) {
    const target = new Date(requested.startsAt).getTime();
    const byTime = slots.find((s) => new Date(s.starts_at).getTime() === target);
    if (byTime) return byTime;
  }
  if (requested.label) {
    const wanted = normalizeSlotLabel(requested.label);
    const byName = slots.find((s) => normalizeSlotLabel(s.name) === wanted);
    if (byName) return byName;
  }
  return null;
}

/**
 * Normalize a slot label for tolerant matching so the Luma dropdown option text
 * doesn't have to match our seeded slot name byte-for-byte: lowercases, maps any
 * dash variant (en/em/figure/minus) to "-", collapses whitespace, and strips
 * spaces around the dash. "11:00 – 11:30 AM" and "11:00-11:30 am" both match.
 */
export function normalizeSlotLabel(v: string): string {
  return v
    .toLowerCase()
    .replace(/[‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .trim();
}

/**
 * Match the guest's requested slot (from the Luma single-select) to a real slot
 * row within the event (PRD §5 / §8.1).
 *
 * NOTE: the exact shape of the Luma answer is being confirmed by research; the
 * matching key may be refined to prefer start time over label.
 */
export async function matchSlotForEvent(params: {
  eventId: string;
  requestedLabel?: string | null;
  requestedStartsAt?: string | null;
}): Promise<SlotRow | null> {
  const slots = await listSlotsForEvent(params.eventId);
  return selectMatchingSlot(slots, {
    label: params.requestedLabel,
    startsAt: params.requestedStartsAt,
  });
}
