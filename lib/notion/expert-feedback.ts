import { getNotionClient } from "./client";
import { env } from "../env";
import { getFeedbackRow, setFeedbackNotionPageId } from "../db/expert-feedback";
import { getAdminClient } from "../supabase/admin";
import { logSync } from "../sync/log";

/** Sentinel stored in notion_dev_page_id while one caller is creating the page,
 * so concurrent pushes for the same booking don't each create a duplicate. */
const PENDING = "pending";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  booking: "Booking", // relation → Dev Bookings DB (the guest's card)
  feedbackType: "Feedback type", // "1:1 guest" (per-1:1) vs "Event" (per-expert-per-event)
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
  /** Dev-workspace page id of the guest's booking card, for the Booking relation. */
  booking_dev_page_id: string | null;
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
    [EF.booking]: { relation: r.booking_dev_page_id ? [{ id: r.booking_dev_page_id }] : [] },
    [EF.feedbackType]: { select: { name: "1:1 guest" } },
  };
}

/**
 * Resolve the single Notion page for a booking, creating it AT MOST ONCE even
 * under concurrent pushes (rapid button taps each fire a background push). Uses a
 * Supabase compare-and-set on notion_dev_page_id (null → "pending") as a per-row
 * mutex: exactly one caller wins the flip and creates; the others wait for the
 * winner to store the real id. Returns the page id, or null if we couldn't get one.
 */
async function resolveFeedbackPageId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  client: ReturnType<typeof getNotionClient>,
  dataSourceId: string,
  bookingId: string,
  currentPageId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: Record<string, unknown>,
): Promise<string | null> {
  // 1) Already have a real, live page → reuse it.
  if (currentPageId && currentPageId !== PENDING) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = (await client.pages.retrieve({ page_id: currentPageId })) as any;
      if (!existing.archived && !existing.in_trash) return currentPageId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not[ _]?found|could not find/i.test(msg)) throw err;
    }
    // Archived / deleted → clear so we can recreate (only if still pointing at it).
    await supabase.from("expert_feedback").update({ notion_dev_page_id: null }).eq("booking_id", bookingId).eq("notion_dev_page_id", currentPageId);
  }

  // 2) Claim the create slot atomically: only the caller that flips null → PENDING creates.
  const { data: claimed } = await supabase
    .from("expert_feedback")
    .update({ notion_dev_page_id: PENDING })
    .eq("booking_id", bookingId)
    .is("notion_dev_page_id", null)
    .select("booking_id");
  if (claimed && claimed.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = (await client.pages.create({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: props as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as any;
    await setFeedbackNotionPageId(bookingId, created.id as string);
    return created.id as string;
  }

  // 3) Another push is creating it → wait briefly for the real id, then update it.
  for (let i = 0; i < 10; i++) {
    await sleep(400);
    const { data } = await supabase.from("expert_feedback").select("notion_dev_page_id").eq("booking_id", bookingId).maybeSingle();
    const v = data?.notion_dev_page_id as string | null | undefined;
    if (v && v !== PENDING) return v;
  }
  return null; // give up quietly; the winner already wrote current state
}

/** One-way push of a feedback row to the Dev Notion DB. Best-effort; no-op if not
 * configured. Creates exactly one page per booking (race-safe) and updates it so
 * the latest answer state always wins. */
export async function pushExpertFeedback(bookingId: string): Promise<void> {
  const dataSourceId = env.notionDev.expertFeedbackDataSourceId();
  if (!dataSourceId) return; // not configured yet
  try {
    const supabase = getAdminClient();
    const row = await getFeedbackRow(bookingId);
    if (!row) return;
    // Join event/slot context for display fields. NOTE: the column is `location`,
    // not `city` — a wrong name makes Supabase fail the whole select and null out
    // every joined field.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bd } = await (supabase as any)
      .from("booking_details")
      .select("event_name, event_date, location, slot_name, guest_email")
      .eq("id", bookingId)
      .maybeSingle();
    // The guest's booking card in the Dev bookings DB, for the Booking relation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bk } = await (supabase as any)
      .from("bookings")
      .select("notion_dev_page_id")
      .eq("id", bookingId)
      .maybeSingle();
    const props = expertFeedbackProperties({
      booking_id: row.booking_id,
      expert_name: row.expert_name,
      expert_email: row.expert_email,
      guest_name: row.guest_name,
      guest_email: row.guest_email ?? bd?.guest_email ?? null,
      attended: row.attended,
      rating: row.rating,
      note: row.note,
      responded_at: row.responded_at,
      event_name: bd?.event_name ?? null,
      event_date: bd?.event_date ?? null,
      location: bd?.location ?? null,
      slot_name: bd?.slot_name ?? null,
      booking_dev_page_id: bk?.notion_dev_page_id ?? null,
    });
    const client = getNotionClient("dev");
    const pageId = await resolveFeedbackPageId(supabase, client, dataSourceId, bookingId, row.notion_dev_page_id, props);
    if (!pageId) return;
    // Final update so the latest state wins regardless of who created the page.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.pages.update({ page_id: pageId, properties: props as any });
  } catch (err) {
    await logSync({ direction: "hub_to_dev", result: "error", bookingId, action: "expert_feedback_notion", note: err instanceof Error ? err.message : String(err) });
  }
}
