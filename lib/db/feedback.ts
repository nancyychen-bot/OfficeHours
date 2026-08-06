import { getAdminClient } from "../supabase/admin";

/**
 * Data access + pure matching logic for feedback-form enrichment.
 *
 * A feedback response carries only the respondent's email (no date/location).
 * We resolve the event they attended by matching that email to a recent booking
 * in the hub, then the webhook writes Event Date + Location back onto the row.
 */

export interface EventCandidate {
  eventId: string;
  eventDate: string; // ISO date "YYYY-MM-DD"
  city: string | null;
  helperName: string | null; // the Notion expert who helped them, if any
}

/** ISO date "YYYY-MM-DD" that is `n` days before `isoDate` (UTC, no tz shift). */
export function isoDateMinusDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Pure + unit-tested. Of the candidate events, keep those whose date falls in the
 * 7 days up to and including the submission date, and return the most recent.
 * Feedback almost always refers to the event just attended.
 */
export function selectEventForFeedback(
  candidates: EventCandidate[],
  submittedAtISO: string,
): EventCandidate | null {
  const sub = submittedAtISO.slice(0, 10);
  const since = isoDateMinusDays(sub, 7);
  const inWindow = candidates.filter((c) => c.eventDate >= since && c.eventDate <= sub);
  if (inWindow.length === 0) return null;
  return inWindow.reduce((a, b) => (b.eventDate > a.eventDate ? b : a));
}

/**
 * Find the event a feedback response belongs to: a booking whose guest OR notion
 * email matches (case-insensitive), for an event dated within the last 7 days of
 * the submission. Most-recent event wins. Returns null when nothing matches.
 */
export async function findEventForFeedback(
  email: string,
  submittedAtISO: string,
): Promise<EventCandidate | null> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  const supabase = getAdminClient();
  const sub = submittedAtISO.slice(0, 10);
  const since = isoDateMinusDays(sub, 7);

  const { data, error } = await supabase
    .from("bookings")
    .select("guest_email, notion_email, booked_by_display_name, events!inner(id, event_date, city)")
    .gte("events.event_date", since)
    .lte("events.event_date", sub);
  if (error) throw error;

  const candidates: EventCandidate[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const g = (row.guest_email ?? "").toLowerCase();
    const n = (row.notion_email ?? "").toLowerCase();
    if (g !== wanted && n !== wanted) continue;
    const ev = row.events;
    if (!ev) continue;
    candidates.push({
      eventId: ev.id,
      eventDate: ev.event_date,
      city: ev.city ?? null,
      helperName: row.booked_by_display_name ?? null,
    });
  }
  return selectEventForFeedback(candidates, submittedAtISO);
}

// ---- feedback_mirror (idempotency map) — loose access, not in generated types --

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getAdminClient() as any).from("feedback_mirror");
}

export interface FeedbackMirrorRow {
  ambassador_page_id: string;
  dev_page_id: string | null;
  matched_event_id: string | null;
  needs_review: boolean;
}

/** The existing mirror mapping for an Ambassador feedback page, if any. */
export async function getFeedbackMirror(ambassadorPageId: string): Promise<FeedbackMirrorRow | null> {
  const { data, error } = await table()
    .select("ambassador_page_id, dev_page_id, matched_event_id, needs_review")
    .eq("ambassador_page_id", ambassadorPageId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Record/refresh the Ambassador→Dev mapping after mirroring a response. */
export async function upsertFeedbackMirror(input: {
  ambassadorPageId: string;
  devPageId: string | null;
  matchedEventId: string | null;
  needsReview: boolean;
}): Promise<void> {
  const { error } = await table().upsert(
    {
      ambassador_page_id: input.ambassadorPageId,
      dev_page_id: input.devPageId,
      matched_event_id: input.matchedEventId,
      needs_review: input.needsReview,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "ambassador_page_id" },
  );
  if (error) throw error;
}
