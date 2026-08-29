import { getNotionClient } from "../notion/client";
import { FB, readSelectName } from "../notion/feedback";
import { listUnresolvedFeedbackMirror, setFeedbackMirrorAttribution } from "../db/feedback";
import { findEventByCityAndDate } from "../db/events";
import { logSync } from "../sync/log";

/** How far back to reconcile unresolved feedback (bounds the Notion re-reads). */
const RECONCILE_WINDOW_DAYS = 30;

/**
 * Reconcile the hub's feedback attribution with the Notion agent's decision.
 *
 * The feedback webhook runs when the form row is created, but the Notion agent
 * fills Event Date + Location asynchronously afterwards — so an email-mismatch
 * response (no Build Bar booking match) lands as needs_review with no
 * matched_event_id and drops out of the per-event rollups. This pass re-reads the
 * agent-set city + date off the Dev page and, when they resolve to a hub event,
 * attributes the row and clears its review flag. Best-effort; runs hourly.
 *
 * A row with no agent city/date yet (agent hasn't run) or no matching hub event
 * (e.g. a Notion 101 event, which isn't in `events`) is left for the next run /
 * manual review — it's simply skipped, never errored.
 */
export async function reconcileFeedbackAttribution(now: Date = new Date()): Promise<{ scanned: number; reconciled: number }> {
  const since = new Date(now.getTime() - RECONCILE_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = await listUnresolvedFeedbackMirror(since);
  const dev = getNotionClient("dev");
  let reconciled = 0;
  for (const r of rows) {
    if (!r.dev_page_id) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page = (await dev.pages.retrieve({ page_id: r.dev_page_id })) as any;
      const props = page.properties ?? {};
      const city = readSelectName(props, FB.location);
      const date = props[FB.eventDate]?.date?.start?.slice(0, 10) ?? null;
      if (!city || !date) continue; // agent hasn't tagged it yet → retry next run
      const ev = await findEventByCityAndDate(city, date);
      if (!ev) continue; // no matching hub event (e.g. Notion 101) → leave for review
      if (ev.id === r.matched_event_id && !r.needs_review) continue; // already correct
      await setFeedbackMirrorAttribution(r.ambassador_page_id, ev.id);
      reconciled++;
      await logSync({
        direction: "notion_dev_in",
        result: "applied",
        action: "feedback_reconciled",
        note: `${r.ambassador_page_id} → ${ev.city} ${ev.event_date} (${ev.id})`,
      });
    } catch (err) {
      await logSync({
        direction: "notion_dev_in",
        result: "error",
        action: "feedback_reconcile",
        note: `${r.ambassador_page_id}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { scanned: rows.length, reconciled };
}
