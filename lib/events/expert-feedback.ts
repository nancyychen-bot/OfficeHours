export interface FeedbackDetailRow {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  challenge: string | null;
  slot_name: string | null;
  slot_starts_at: string | null;
  booked_by_email: string | null;
  booked_by_display_name: string | null;
  status: string | null;
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
}

export interface FeedbackItem {
  bookingId: string;
  guestName: string;
  guestEmail: string | null;
  slotName: string | null;
  challenge: string | null;
}

export interface ExpertFeedbackPrompt {
  email: string;
  name: string;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  items: FeedbackItem[];
}

/** Pure: group an event's completed 1:1s into one feedback prompt per expert. Keeps
 * booking ids so each interaction maps back to a row. Only assigned/checked_in. */
export function buildFeedbackPrompts(rows: FeedbackDetailRow[]): ExpertFeedbackPrompt[] {
  const byEmail = new Map<string, ExpertFeedbackPrompt>();
  for (const r of rows) {
    if (!r.booked_by_email) continue;
    if (r.status !== "assigned" && r.status !== "checked_in") continue;
    const key = r.booked_by_email.trim().toLowerCase();
    const p =
      byEmail.get(key) ??
      {
        email: r.booked_by_email,
        name: r.booked_by_display_name ?? "there",
        eventId: r.event_id,
        eventName: r.event_name,
        eventDate: r.event_date,
        items: [] as FeedbackItem[],
      };
    p.items.push({
      bookingId: r.id,
      guestName: r.guest_name ?? "Guest",
      guestEmail: r.guest_email,
      slotName: r.slot_name,
      challenge: r.challenge,
    });
    byEmail.set(key, p);
  }
  for (const p of byEmail.values()) {
    p.items.sort((a, b) => (a.slotName ?? "").localeCompare(b.slotName ?? ""));
  }
  return [...byEmail.values()];
}
