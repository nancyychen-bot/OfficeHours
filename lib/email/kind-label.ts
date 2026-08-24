/** Human-friendly label for an email_log event_kind, e.g. "prep_reminder" → "Prep reminder". Pure. */
export function emailKindLabel(kind: string): string {
  if (!kind) return "";
  const spaced = kind.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
