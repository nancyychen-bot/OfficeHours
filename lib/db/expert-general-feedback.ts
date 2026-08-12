import { getAdminClient } from "../supabase/admin";

export interface GeneralFeedbackInput {
  eventId: string;
  expertEmail: string;
  expertName: string | null;
  note: string;
  eventName: string | null;
  eventDate: string | null;
  location: string | null;
}

export interface GeneralFeedbackRow {
  event_id: string;
  expert_email: string;
  expert_name: string | null;
  note: string | null;
  event_name: string | null;
  event_date: string | null;
  location: string | null;
  notion_dev_page_id: string | null;
  responded_at: string | null;
}

/** Upsert the single general entry for (event, expert). Preserves notion_dev_page_id
 * (not in the payload, so an on-conflict update leaves it untouched). */
export async function upsertGeneralFeedback(input: GeneralFeedbackInput): Promise<void> {
  const now = new Date().toISOString();
  await getAdminClient().from("expert_general_feedback").upsert(
    {
      event_id: input.eventId,
      expert_email: input.expertEmail,
      expert_name: input.expertName,
      note: input.note,
      event_name: input.eventName,
      event_date: input.eventDate,
      location: input.location,
      responded_at: now,
      updated_at: now,
    },
    { onConflict: "event_id,expert_email" },
  );
}

export async function getGeneralFeedback(eventId: string, expertEmail: string): Promise<GeneralFeedbackRow | null> {
  const { data } = await getAdminClient()
    .from("expert_general_feedback")
    .select("*")
    .eq("event_id", eventId)
    .ilike("expert_email", expertEmail)
    .maybeSingle();
  return (data as GeneralFeedbackRow | null) ?? null;
}

export async function setGeneralFeedbackNotionPageId(eventId: string, expertEmail: string, pageId: string): Promise<void> {
  await getAdminClient()
    .from("expert_general_feedback")
    .update({ notion_dev_page_id: pageId })
    .eq("event_id", eventId)
    .eq("expert_email", expertEmail);
}

export async function listGeneralFeedback(): Promise<GeneralFeedbackRow[]> {
  const { data } = await getAdminClient()
    .from("expert_general_feedback")
    .select("*")
    .order("event_date", { ascending: false });
  return (data as GeneralFeedbackRow[] | null) ?? [];
}
