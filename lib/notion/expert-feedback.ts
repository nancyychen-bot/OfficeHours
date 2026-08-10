import { getNotionClient } from "./client";
import { env } from "../env";
import { getFeedbackRow, setFeedbackNotionPageId } from "../db/expert-feedback";
import { logSync } from "../sync/log";

/** Property names on the Dev "Expert Feedback" database. Must match the DB schema
 * (configure with scripts/configure-expert-feedback-db.ts). */
export const EF = {
  expert: "Expert",
  expertEmail: "Expert email",
  guest: "Guest",
  guestEmail: "Guest email",
  eventDate: "Event Date",
  location: "Location",
  event: "Event",
  slot: "Slot",
  attended: "Attended",
  rating: "Rating",
  note: "Note",
  respondedAt: "Responded at",
  bookingId: "Booking ID",
} as const;

type Props = Record<string, unknown>;

function rich(text: string | null): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return { rich_text: text ? [{ type: "text", text: { content: text.slice(0, 2000) } }] : [] };
}

/** Row shape passed to the mapper (feedback row joined with event/slot context). */
export interface ExpertFeedbackNotionRow {
  booking_id: string;
  expert_name: string | null;
  expert_email: string;
  guest_name: string | null;
  guest_email: string | null;
  event_date: string | null;
  location: string | null;
  event_name: string | null;
  slot_name: string | null;
  attended: boolean | null;
  rating: number | null;
  note: string | null;
  responded_at: string | null;
}

/** Pure: map a feedback row to Dev Notion database properties. */
export function expertFeedbackProperties(r: ExpertFeedbackNotionRow): Props {
  const attended = r.attended === null ? null : r.attended ? "Showed up" : "No-show";
  return {
    [EF.expert]: { title: r.expert_name ? [{ type: "text", text: { content: r.expert_name.slice(0, 2000) } }] : [] },
    [EF.expertEmail]: rich(r.expert_email),
    [EF.guest]: rich(r.guest_name),
    [EF.guestEmail]: rich(r.guest_email),
    [EF.eventDate]: { date: r.event_date ? { start: r.event_date } : null },
    [EF.location]: rich(r.location),
    [EF.event]: rich(r.event_name),
    [EF.slot]: rich(r.slot_name),
    [EF.attended]: { select: attended ? { name: attended } : null },
    [EF.rating]: { number: r.rating ?? null },
    [EF.note]: rich(r.note),
    [EF.respondedAt]: { date: r.responded_at ? { start: r.responded_at } : null },
    [EF.bookingId]: rich(r.booking_id),
  };
}

/** One-way push of a feedback row to the Dev Notion DB. Best-effort; no-op if not
 * configured. Creates on first push (stores page id), updates thereafter. */
export async function pushExpertFeedback(bookingId: string): Promise<void> {
  const dataSourceId = env.notionDev.expertFeedbackDataSourceId();
  if (!dataSourceId) return; // not configured yet
  try {
    const row = await getFeedbackRow(bookingId);
    if (!row) return;
    // Join event/slot context for display fields.
    const { getAdminClient } = await import("../supabase/admin");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bd } = await (getAdminClient() as any)
      .from("booking_details")
      .select("event_name, event_date, city, slot_name")
      .eq("id", bookingId)
      .maybeSingle();
    const props = expertFeedbackProperties({
      booking_id: row.booking_id,
      expert_name: row.expert_name,
      expert_email: row.expert_email,
      guest_name: row.guest_name,
      guest_email: row.guest_email,
      attended: row.attended,
      rating: row.rating,
      note: row.note,
      responded_at: row.responded_at,
      event_name: bd?.event_name ?? null,
      event_date: bd?.event_date ?? null,
      location: bd?.city ?? null,
      slot_name: bd?.slot_name ?? null,
    });
    const client = getNotionClient("dev");
    if (row.notion_dev_page_id) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = (await client.pages.retrieve({ page_id: row.notion_dev_page_id })) as any;
        if (!existing.archived && !existing.in_trash) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await client.pages.update({ page_id: row.notion_dev_page_id, properties: props as any });
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not[ _]?found|could not find/i.test(msg)) throw err;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = (await client.pages.create({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: props as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as any;
    await setFeedbackNotionPageId(bookingId, created.id as string);
  } catch (err) {
    await logSync({ direction: "hub_to_dev", result: "error", bookingId, action: "expert_feedback_notion", note: err instanceof Error ? err.message : String(err) });
  }
}
