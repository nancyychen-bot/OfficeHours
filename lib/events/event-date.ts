/**
 * The calendar date (YYYY-MM-DD) of an instant, in a given IANA timezone.
 * Using the raw UTC slice would put late-evening events (or any event whose
 * local date differs from UTC) on the wrong day, breaking per-event views.
 */
export function localCalendarDate(instantISO: string, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instantISO));
}
