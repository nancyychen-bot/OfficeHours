/** A send rule: fire at (event_date + offsetDays) at targetHour, event-local. */
export interface SendRule {
  offsetDays: number;
  targetHour: number; // 0–23, event-local
}

/** The event-local calendar date (YYYY-MM-DD) and hour (0–23) of an instant. */
export function localNowParts(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // Some ICU versions emit "24" for midnight under hour12:false.
  const hour = Number(get("hour")) % 24;
  return { date, hour };
}

/** A plain calendar-date shift (YYYY-MM-DD + n days), DST-agnostic (anchors on
 * UTC midnight, so adding whole days never drifts across a DST boundary). */
export function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/**
 * True when the event's local clock has reached (event_date + offsetDays) at
 * targetHour and it is still that local day. "At or after, same local day" so a
 * missed hourly tick self-heals within the day; the caller's email_log dedup
 * makes the eventual send exactly-once, and the same-day cap keeps e.g. a
 * "day before" send from leaking onto the event day.
 */
export function isSendDue(
  now: Date,
  event: { event_date: string; timezone: string },
  rule: SendRule,
): boolean {
  const target = shiftDate(event.event_date, rule.offsetDays);
  const { date, hour } = localNowParts(now, event.timezone);
  return date === target && hour >= rule.targetHour;
}

/** The UTC date window (inclusive) to fetch when scanning for due events: a safe
 * superset covering every rule's offset (prep is the earliest at −3) plus ±1 for
 * the local/UTC date skew. Callers filter the result with isSendDue. */
export function scanWindow(now: Date): { from: string; to: string } {
  const utcToday = now.toISOString().slice(0, 10);
  return { from: shiftDate(utcToday, -1), to: shiftDate(utcToday, 4) };
}
