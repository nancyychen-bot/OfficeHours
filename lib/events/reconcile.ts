import type { GeneratedSlot } from "./slots-gen";

export interface ExistingSlot {
  id: string;
  name: string;
}
export interface SlotUpdate extends GeneratedSlot {
  id: string;
}
export interface SlotReconciliation {
  toInsert: GeneratedSlot[];
  toUpdate: SlotUpdate[];
  toDeleteIds: string[];
}

/**
 * Diff existing slots (by name) against the desired set. Matching is by name so
 * a re-run preserves the row (and its bookings) while refreshing times.
 * Callers must filter toDeleteIds to slots WITHOUT a booking before deleting.
 */
export function reconcileSlots(
  existing: ExistingSlot[],
  desired: GeneratedSlot[],
): SlotReconciliation {
  const existingByName = new Map(existing.map((s) => [s.name, s]));
  const desiredNames = new Set(desired.map((s) => s.name));

  const toInsert: GeneratedSlot[] = [];
  const toUpdate: SlotUpdate[] = [];
  for (const slot of desired) {
    const match = existingByName.get(slot.name);
    if (match) toUpdate.push({ id: match.id, ...slot });
    else toInsert.push(slot);
  }
  const toDeleteIds = existing.filter((s) => !desiredNames.has(s.name)).map((s) => s.id);
  return { toInsert, toUpdate, toDeleteIds };
}
