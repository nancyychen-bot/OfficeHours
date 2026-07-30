export interface GeneratedSlot {
  name: string;
  starts_at: string; // ISO (UTC)
  ends_at: string; // ISO (UTC)
}

/**
 * Generate contiguous, equal-length slots. Labels come verbatim from the Luma
 * dropdown (localization-proof); times are computed from an absolute start
 * instant + fixed length + option order.
 */
export function generateSlotsFromOptions(
  labels: string[],
  startAtISO: string,
  lengthMinutes: number,
): GeneratedSlot[] {
  const startMs = new Date(startAtISO).getTime();
  const lenMs = lengthMinutes * 60_000;
  return labels.map((name, i) => {
    const s = startMs + i * lenMs;
    return {
      name,
      starts_at: new Date(s).toISOString(),
      ends_at: new Date(s + lenMs).toISOString(),
    };
  });
}
