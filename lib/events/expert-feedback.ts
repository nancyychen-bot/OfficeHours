import { getAdminClient } from "../supabase/admin";
import { dmByEmail } from "../slack/api";
import { buildFeedbackBlocks } from "../slack/blocks";
import { createFeedbackRows, hasFeedbackRows } from "../db/expert-feedback";
import { logSync } from "../sync/log";

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

/** Pure: has the latest slot's END time passed at least `thresholdHours` before
 * `now`? `slotEndsAt` are ISO strings (slots.ends_at). */
export function lastSlotEndedHoursAgo(slotEndsAt: string[], thresholdHours: number, now: Date): boolean {
  const ends = slotEndsAt.map((s) => Date.parse(s)).filter((n) => Number.isFinite(n));
  if (!ends.length) return false;
  const latestEnd = Math.max(...ends);
  return now.getTime() - latestEnd >= thresholdHours * 3_600_000;
}

/** Send the feedback DM for one event: build prompts, create rows, DM each expert.
 * Idempotent per (event, expert) via hasFeedbackRows. Returns experts prompted. */
export async function sendFeedbackForEvent(eventId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data } = await supabase
    .from("booking_details")
    .select("id, guest_name, guest_email, challenge, slot_name, slot_starts_at, booked_by_email, booked_by_display_name, status, event_id, event_name, event_date")
    .eq("event_id", eventId);
  const prompts = buildFeedbackPrompts((data ?? []) as FeedbackDetailRow[]);
  let prompted = 0;
  for (const p of prompts) {
    if (await hasFeedbackRows(eventId, p.email)) continue; // already prompted
    await createFeedbackRows(
      p.items.map((it) => ({
        bookingId: it.bookingId,
        eventId: p.eventId,
        expertEmail: p.email,
        expertName: p.name,
        guestName: it.guestName,
        guestEmail: it.guestEmail,
      })),
    );
    try {
      await dmByEmail(p.email, buildFeedbackBlocks(p), `How did your ${p.eventName ?? "Build Bar"} 1:1s go?`);
      prompted++;
    } catch (err) {
      await logSync({ direction: "luma_in", result: "error", action: "expert_feedback_dm", note: err instanceof Error ? err.message : String(err) });
    }
  }
  return prompted;
}

/**
 * Send feedback DMs for every event whose last slot ended >= 2h ago and hasn't
 * been prompted yet. Returns counts.
 */
export async function sendFeedbackForEndedEvents(now: Date = new Date()): Promise<{ events: number; experts: number }> {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data: events } = await supabase
    .from("events")
    .select("id, status, event_date")
    .in("event_date", [today, yesterday])
    .neq("status", "cancelled");
  let eventsPrompted = 0;
  let experts = 0;
  for (const ev of (events ?? []) as Array<{ id: string; event_date: string }>) {
    const { data: slots } = await supabase.from("slots").select("ends_at").eq("event_id", ev.id);
    const ends = (slots ?? []).map((s: { ends_at: string }) => s.ends_at);
    if (!lastSlotEndedHoursAgo(ends, 2, now)) continue;
    const n = await sendFeedbackForEvent(ev.id);
    if (n > 0) { eventsPrompted++; experts += n; }
  }
  return { events: eventsPrompted, experts };
}
