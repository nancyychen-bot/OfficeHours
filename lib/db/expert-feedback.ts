import { getAdminClient } from "../supabase/admin";

export interface FeedbackRowInput {
  bookingId: string;
  eventId: string | null;
  expertEmail: string;
  expertName: string | null;
  guestName: string | null;
  guestEmail: string | null;
}

export interface AnswerInput {
  attended?: boolean;
  rating?: number;
  note?: string;
}

export interface AnswerPatch {
  attended?: boolean;
  rating?: number;
  note?: string;
  responded_at?: string;
  updated_at: string;
}

/**
 * Pure: build the DB patch for one answer. Stamps responded_at ONLY when there
 * isn't one yet (first answer wins the timestamp). Always bumps updated_at.
 */
export function buildAnswerPatch(answer: AnswerInput, existingRespondedAt: string | null, nowIso: string): AnswerPatch {
  const patch: AnswerPatch = { updated_at: nowIso };
  if (answer.attended !== undefined) patch.attended = answer.attended;
  if (answer.rating !== undefined) patch.rating = answer.rating;
  if (answer.note !== undefined) patch.note = answer.note;
  if (!existingRespondedAt) patch.responded_at = nowIso;
  return patch;
}

/** Insert one row per booking when the DM is sent. Idempotent (skips existing PKs). */
export async function createFeedbackRows(rows: FeedbackRowInput[]): Promise<void> {
  if (!rows.length) return;
  await getAdminClient()
    .from("expert_feedback")
    .upsert(
      rows.map((r) => ({
        booking_id: r.bookingId,
        event_id: r.eventId,
        expert_email: r.expertEmail,
        expert_name: r.expertName,
        guest_name: r.guestName,
        guest_email: r.guestEmail,
      })),
      { onConflict: "booking_id", ignoreDuplicates: true },
    );
}

/** True if we've already created feedback rows for this (event, expert). Dedup guard. */
export async function hasFeedbackRows(eventId: string, expertEmail: string): Promise<boolean> {
  const { data } = await getAdminClient()
    .from("expert_feedback")
    .select("booking_id")
    .eq("event_id", eventId)
    .ilike("expert_email", expertEmail)
    .limit(1);
  return (data ?? []).length > 0;
}

/** Apply one answer to a booking's feedback row. Returns nothing; best-effort caller. */
export async function upsertFeedbackAnswer(bookingId: string, answer: AnswerInput): Promise<void> {
  const supabase = getAdminClient();
  const { data: existing } = await supabase
    .from("expert_feedback")
    .select("responded_at")
    .eq("booking_id", bookingId)
    .maybeSingle();
  const patch = buildAnswerPatch(answer, existing?.responded_at ?? null, new Date().toISOString());
  await supabase.from("expert_feedback").update(patch).eq("booking_id", bookingId);
}

export interface ExpertFeedbackRow {
  booking_id: string;
  event_id: string | null;
  expert_email: string;
  expert_name: string | null;
  guest_name: string | null;
  guest_email: string | null;
  attended: boolean | null;
  rating: number | null;
  note: string | null;
  responded_at: string | null;
  notion_dev_page_id: string | null;
}

/** Read a single feedback row (for the Notion push). */
export async function getFeedbackRow(bookingId: string): Promise<ExpertFeedbackRow | null> {
  const { data } = await getAdminClient().from("expert_feedback").select("*").eq("booking_id", bookingId).maybeSingle();
  return (data as ExpertFeedbackRow | null) ?? null;
}

/** Store the Notion page id after the first push (idempotency for subsequent updates). */
export async function setFeedbackNotionPageId(bookingId: string, pageId: string): Promise<void> {
  await getAdminClient().from("expert_feedback").update({ notion_dev_page_id: pageId }).eq("booking_id", bookingId);
}
