import { getNotionClient } from "./client";
import { env } from "../env";
import { getGeneralFeedback, setGeneralFeedbackNotionPageId } from "../db/expert-general-feedback";
import { getAdminClient } from "../supabase/admin";
import { EF } from "./expert-feedback";
import { logSync } from "../sync/log";

const PENDING = "pending";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Props = Record<string, unknown>;
function rich(text: string | null): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return { rich_text: text ? [{ type: "text", text: { content: text.slice(0, 2000) } }] : [] };
}

export interface GeneralFeedbackNotionRow {
  expert_name: string | null;
  expert_email: string;
  note: string | null;
  event_name: string | null;
  event_date: string | null;
  location: string | null;
  responded_at: string | null;
}

/** Pure: map a general entry to Dev Notion properties. Guest/Rating/Attended/Slot/
 * Booking are intentionally left blank — a General entry isn't tied to a guest. */
export function generalFeedbackProperties(r: GeneralFeedbackNotionRow): Props {
  return {
    [EF.expert]: { title: r.expert_name ? [{ type: "text", text: { content: r.expert_name.slice(0, 2000) } }] : [] },
    [EF.expertEmail]: rich(r.expert_email),
    [EF.guest]: rich(null),
    [EF.event]: rich(r.event_name),
    [EF.eventDate]: { date: r.event_date ? { start: r.event_date } : null },
    [EF.location]: rich(r.location),
    [EF.note]: rich(r.note),
    [EF.respondedAt]: { date: r.responded_at ? { start: r.responded_at } : null },
    [EF.feedbackType]: { select: { name: "Event" } },
  };
}

/** Resolve the single Notion page for a general entry, creating at most once even
 * under concurrent pushes (compare-and-set on notion_dev_page_id per event+expert). */
async function resolvePageId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  client: ReturnType<typeof getNotionClient>,
  dataSourceId: string,
  eventId: string,
  expertEmail: string,
  currentPageId: string | null,
  props: Props,
): Promise<string | null> {
  if (currentPageId && currentPageId !== PENDING) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = (await client.pages.retrieve({ page_id: currentPageId })) as any;
      if (!existing.archived && !existing.in_trash) return currentPageId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not[ _]?found|could not find/i.test(msg)) throw err;
    }
    await supabase.from("expert_general_feedback").update({ notion_dev_page_id: null }).eq("event_id", eventId).eq("expert_email", expertEmail).eq("notion_dev_page_id", currentPageId);
  }
  const { data: claimed } = await supabase
    .from("expert_general_feedback")
    .update({ notion_dev_page_id: PENDING })
    .eq("event_id", eventId)
    .eq("expert_email", expertEmail)
    .is("notion_dev_page_id", null)
    .select("event_id");
  if (claimed && claimed.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = (await client.pages.create({ parent: { type: "data_source_id", data_source_id: dataSourceId }, properties: props as any } as any)) as any;
    await setGeneralFeedbackNotionPageId(eventId, expertEmail, created.id as string);
    return created.id as string;
  }
  for (let i = 0; i < 10; i++) {
    await sleep(400);
    const { data } = await supabase.from("expert_general_feedback").select("notion_dev_page_id").eq("event_id", eventId).eq("expert_email", expertEmail).maybeSingle();
    const v = data?.notion_dev_page_id as string | null | undefined;
    if (v && v !== PENDING) return v;
  }
  return null;
}

/** One-way, race-safe push of a general entry to the Dev feedback DB. Best-effort. */
export async function pushGeneralFeedback(eventId: string, expertEmail: string): Promise<void> {
  const dataSourceId = env.notionDev.expertFeedbackDataSourceId();
  if (!dataSourceId) return;
  try {
    const row = await getGeneralFeedback(eventId, expertEmail);
    if (!row) return;
    const props = generalFeedbackProperties({
      expert_name: row.expert_name,
      expert_email: row.expert_email,
      note: row.note,
      event_name: row.event_name,
      event_date: row.event_date,
      location: row.location,
      responded_at: row.responded_at,
    });
    const client = getNotionClient("dev");
    const pageId = await resolvePageId(getAdminClient(), client, dataSourceId, eventId, expertEmail, row.notion_dev_page_id, props);
    if (!pageId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.pages.update({ page_id: pageId, properties: props as any });
  } catch (err) {
    await logSync({ direction: "hub_to_dev", result: "error", action: "expert_general_feedback_notion", note: err instanceof Error ? err.message : String(err) });
  }
}
