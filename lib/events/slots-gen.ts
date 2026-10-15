export interface GeneratedSlot {
  name: string;
  starts_at: string; // ISO (UTC)
  ends_at: string; // ISO (UTC)
}

/** A slot label's start/end as minutes-since-local-midnight, or null if the
 * label isn't a parseable clock-time range. */
interface ParsedRange {
  startMin: number;
  endMin: number;
}

/** 12h clock → 24h hour, honoring an AM/PM meridian (12 AM = 0, 12 PM = 12). */
function to24(hour: number, meridian: string | undefined): number {
  if (!meridian) return hour; // already 24h (no meridian anywhere)
  const m = meridian.toUpperCase();
  if (m === "PM") return hour === 12 ? 12 : hour + 12;
  return hour === 12 ? 0 : hour; // AM
}

/**
 * Parse a clock-time range label like "5:00-5:20PM", "2:00-2:30 PM", or
 * "17:00-17:20" into minutes-since-midnight. A meridian on only one side is
 * inherited by the other (evening slots write "5:40-6:00PM"). Returns null for
 * anything that isn't a plain H:MM–H:MM range (localized/opaque labels), which
 * makes the caller fall back to fixed-length spacing.
 */
function parseSlotTimeRange(label: string): ParsedRange | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AP]M)?\s*[-–—~〜]\s*(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(label);
  if (!m) return null;
  const [, sh, sm, sMer, eh, em, eMer] = m;
  const startMer = sMer ?? eMer;
  const endMer = eMer ?? sMer;
  const startMin = to24(Number(sh), startMer) * 60 + Number(sm);
  const endMin = to24(Number(eh), endMer) * 60 + Number(em);
  if (endMin <= startMin) return null; // not a forward range → treat as unparseable
  return { startMin, endMin };
}

/**
 * Generate slots for a list of Luma dropdown labels. The labels are the source
 * of truth: when every label is a parseable clock-time range, each slot's time
 * is derived from its OWN label (anchored so the first label's start === the
 * event start), so any cadence works — 20-min, 30-min, or with gaps — and the
 * times (and therefore the calendar-invite durations) never drift from the
 * labels.
 *
 * Only when a label can't be parsed (localized/opaque text) do we fall back to
 * the old behavior: contiguous, equal `lengthMinutes` blocks from the start.
 */
export function generateSlotsFromOptions(
  labels: string[],
  startAtISO: string,
  lengthMinutes: number,
): GeneratedSlot[] {
  const startMs = new Date(startAtISO).getTime();
  const parsed = labels.map(parseSlotTimeRange);

  const allParsed = labels.length > 0 && parsed.every((p): p is ParsedRange => p !== null);
  const anchorMin = allParsed ? (parsed[0] as ParsedRange).startMin : 0;
  const monotonic =
    allParsed &&
    parsed.every((p, i) => i === 0 || (p as ParsedRange).startMin >= (parsed[i - 1] as ParsedRange).startMin);

  if (allParsed && monotonic) {
    return labels.map((name, i) => {
      const p = parsed[i] as ParsedRange;
      const s = startMs + (p.startMin - anchorMin) * 60_000;
      const e = startMs + (p.endMin - anchorMin) * 60_000;
      return { name, starts_at: new Date(s).toISOString(), ends_at: new Date(e).toISOString() };
    });
  }

  // Fallback: contiguous, equal-length blocks (labels aren't clock-time ranges).
  const lenMs = lengthMinutes * 60_000;
  return labels.map((name, i) => {
    const s = startMs + i * lenMs;
    return { name, starts_at: new Date(s).toISOString(), ends_at: new Date(s + lenMs).toISOString() };
  });
}
