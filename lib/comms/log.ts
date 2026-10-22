import type { CommsKind, Recipient } from "../email/templates";

export interface RawLogRow {
  booking_id: string;
  event_kind: string;
  recipient_role: string;
  recipient_email: string | null;
  status: string;
  created_at: string;
}
export interface SentLogRow {
  when: string;
  category: string;
  kind: string;
  role: string;
  guestName: string | null;
  recipientEmail: string | null;
  status: string;
}

/** "GUEST · assigned" / "EXPERT · day_of_agenda". */
export function logCategory(kind: CommsKind | string, role: Recipient | string): string {
  return `${role === "helper" ? "EXPERT" : "GUEST"} · ${kind}`;
}

/** Join raw email_log rows to guest names (by booking id) → display rows, newest first. */
export function toSentLogRows(raw: RawLogRow[], guestByBooking: Map<string, string | null>): SentLogRow[] {
  return raw
    .map((r) => ({
      when: r.created_at,
      category: logCategory(r.event_kind, r.recipient_role),
      kind: r.event_kind,
      role: r.recipient_role,
      guestName: guestByBooking.get(r.booking_id) ?? null,
      recipientEmail: r.recipient_email,
      status: r.status,
    }))
    .sort((a, b) => b.when.localeCompare(a.when));
}
