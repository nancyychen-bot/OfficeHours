import { getAdminClient } from "../supabase/admin";
import { listGeneralFeedback } from "../db/expert-general-feedback";

export interface ExpertFeedbackListRow {
  type: "Guest" | "General";
  expert: string | null;
  eventName: string | null;
  eventDate: string | null;
  guest: string | null;
  attended: boolean | null;
  rating: number | null;
  note: string | null;
  respondedAt: string | null;
}

/** Unified, read-only list of Slack-captured expert feedback: per-1:1 Guest rows +
 * per-event General rows, newest event first. */
export async function listExpertFeedback(): Promise<ExpertFeedbackListRow[]> {
  const supabase = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: guest } = await (supabase as any)
    .from("expert_feedback")
    .select("expert_name, guest_name, attended, rating, note, responded_at, event_id");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: events } = await (supabase as any).from("events").select("id, name, event_date");
  const evMap = new Map<string, { name: string | null; date: string | null }>();
  for (const e of events ?? []) evMap.set(e.id, { name: e.name ?? null, date: e.event_date ?? null });

  const guestRows: ExpertFeedbackListRow[] = (guest ?? []).map((r: Record<string, unknown>) => ({
    type: "Guest" as const,
    expert: (r.expert_name as string) ?? null,
    eventName: evMap.get(r.event_id as string)?.name ?? null,
    eventDate: evMap.get(r.event_id as string)?.date ?? null,
    guest: (r.guest_name as string) ?? null,
    attended: (r.attended as boolean) ?? null,
    rating: (r.rating as number) ?? null,
    note: (r.note as string) ?? null,
    respondedAt: (r.responded_at as string) ?? null,
  }));

  const generalRows: ExpertFeedbackListRow[] = (await listGeneralFeedback()).map((r) => ({
    type: "General" as const,
    expert: r.expert_name,
    eventName: r.event_name,
    eventDate: r.event_date,
    guest: null,
    attended: null,
    rating: null,
    note: r.note,
    respondedAt: r.responded_at,
  }));

  return [...guestRows, ...generalRows].sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""));
}
