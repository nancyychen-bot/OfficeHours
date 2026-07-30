import { getNotionClient, bookingsDataSourceId, type NotionWorkspace } from "./client";
import {
  bookingToPageProperties,
  syncedFieldsToUpdateProperties,
  releaseUpdateProperties,
  type PushOptions,
} from "./mappers";
import { setNotionPageId, stampSynced } from "../db/bookings";
import { pickSyncedFields, type Booking } from "../sync/types";
import { logSync } from "../sync/log";

/**
 * Outbound sync leg: hub → Notion (PRD §7.3 / §8.4).
 *
 * Creates the mirrored page on first push (storing its id) or updates the synced
 * fields on subsequent pushes, in each configured workspace. After a successful
 * push we `stampSynced` so the resulting echo webhook is recognized and dropped.
 *
 * Guarded: if a workspace's token / data-source id isn't configured yet, that
 * leg is skipped (so this is safe to call before the Notion setup is complete).
 */

function isConfigured(workspace: NotionWorkspace): boolean {
  try {
    getNotionClient(workspace);
    bookingsDataSourceId(workspace);
    return true;
  } catch {
    return false;
  }
}

async function pushToWorkspace(
  workspace: NotionWorkspace,
  booking: Booking,
  opts: PushOptions,
): Promise<"created" | "updated" | "skipped"> {
  if (!isConfigured(workspace)) return "skipped";

  const notion = getNotionClient(workspace);
  const existingPageId =
    workspace === "dev" ? booking.notion_dev_page_id : booking.notion_ambassador_page_id;

  if (existingPageId) {
    await notion.pages.update({
      page_id: existingPageId,
      // Notion SDK's property typing is stricter than our generic builder.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: syncedFieldsToUpdateProperties(pickSyncedFields(booking)) as any,
    });
    return "updated";
  }

  const created = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: bookingsDataSourceId(workspace) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: bookingToPageProperties(booking, opts) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  await setNotionPageId(booking.id, workspace, created.id);
  return "created";
}

export interface PushResult {
  dev: "created" | "updated" | "skipped" | "error";
  ambassador: "created" | "updated" | "skipped" | "error";
}

/**
 * Push a booking to both workspaces. `opts` per-workspace lets us withhold
 * sensitive fields from one side (PRD §12 / GDPR).
 */
export async function pushBookingToWorkspaces(
  booking: Booking,
  opts: { dev?: PushOptions; ambassador?: PushOptions; skip?: NotionWorkspace[] } = {},
): Promise<PushResult> {
  const result: PushResult = { dev: "skipped", ambassador: "skipped" };
  const skip = new Set(opts.skip ?? []);

  for (const workspace of ["dev", "ambassador"] as const) {
    if (skip.has(workspace)) continue;
    try {
      result[workspace] = await pushToWorkspace(workspace, booking, opts[workspace] ?? {});
    } catch (err) {
      result[workspace] = "error";
      await logSync({
        direction: workspace === "dev" ? "hub_to_dev" : "hub_to_amb",
        result: "error",
        bookingId: booking.id,
        action: "push",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Stamp loop-prevention hash once, reflecting the state we just pushed.
  if (result.dev !== "skipped" || result.ambassador !== "skipped") {
    try {
      await stampSynced(booking.id, booking);
    } catch (err) {
      console.error("[push] stampSynced failed", err);
    }
  }

  return result;
}

/**
 * Fully clear a booking's mirrored pages in BOTH workspaces on release/unclaim —
 * sets Status → Unassigned and clears the name, type, and native Person. Unlike
 * the claim mirror, this writes to both sides (including the origin) so an
 * unclaim leaves no stale chips anywhere. `released` should be the post-release
 * (unassigned) booking so the loop-prevention stamp matches.
 */
export async function clearBookingInWorkspaces(released: Booking): Promise<void> {
  for (const workspace of ["dev", "ambassador"] as const) {
    if (!isConfigured(workspace)) continue;
    const pageId =
      workspace === "dev" ? released.notion_dev_page_id : released.notion_ambassador_page_id;
    if (!pageId) continue;
    try {
      const notion = getNotionClient(workspace);
      await notion.pages.update({
        page_id: pageId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties: releaseUpdateProperties() as any,
      });
    } catch (err) {
      await logSync({
        direction: workspace === "dev" ? "hub_to_dev" : "hub_to_amb",
        result: "error",
        bookingId: released.id,
        action: "clear",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }
  try {
    await stampSynced(released.id, released);
  } catch (err) {
    console.error("[push] stampSynced (release) failed", err);
  }
}

/**
 * Archive (trash) a booking's mirrored pages in both workspaces — used on
 * cancellation so the card disappears from every board. Best-effort per side.
 */
export async function archiveBookingPages(booking: Booking): Promise<void> {
  for (const workspace of ["dev", "ambassador"] as const) {
    if (!isConfigured(workspace)) continue;
    const pageId =
      workspace === "dev" ? booking.notion_dev_page_id : booking.notion_ambassador_page_id;
    if (!pageId) continue;
    try {
      const notion = getNotionClient(workspace);
      await notion.pages.update({ page_id: pageId, archived: true });
    } catch (err) {
      await logSync({
        direction: workspace === "dev" ? "hub_to_dev" : "hub_to_amb",
        result: "error",
        bookingId: booking.id,
        action: "archive",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
