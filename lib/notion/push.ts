import { getNotionClient, bookingsDataSourceId, type NotionWorkspace } from "./client";
import {
  bookingToPageProperties,
  syncedFieldsToUpdateProperties,
  releaseUpdateProperties,
  type PushOptions,
} from "./mappers";
import { PROP } from "./schema";
import { setNotionPageId, stampSynced } from "../db/bookings";
import { pickSyncedFields, type Booking } from "../sync/types";
import { logSync } from "../sync/log";

/**
 * Find an existing card for a guest by the "Luma guest id" property. Idempotency
 * guard: a new signup fires guest.registered + guest.updated ~1s apart, and if
 * both push before the first card's id is stored, each would create a card. By
 * adopting any card already tagged with this guest id, the second push updates
 * instead of duplicating (also self-heals if a page id was ever lost).
 */
async function findCardByLumaGuestId(
  notion: ReturnType<typeof getNotionClient>,
  workspace: NotionWorkspace,
  lumaGuestId: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = (await (notion as any).dataSources.query({
    data_source_id: bookingsDataSourceId(workspace),
    filter: { property: PROP.lumaGuestId, rich_text: { equals: lumaGuestId } },
    page_size: 5,
  })) as { results?: Array<{ id: string; archived?: boolean; in_trash?: boolean }> };
  const pages = res.results ?? [];
  const live = pages.find((p) => !p.archived && !p.in_trash) ?? pages[0];
  return live?.id ?? null;
}

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
  fullUpdate: boolean,
): Promise<"created" | "updated" | "skipped"> {
  if (!isConfigured(workspace)) return "skipped";

  const notion = getNotionClient(workspace);
  const existingPageId =
    workspace === "dev" ? booking.notion_dev_page_id : booking.notion_ambassador_page_id;

  if (existingPageId) {
    // Check the stored card is still LIVE before updating. A manually-deleted
    // card leaves a dead id here; Notion then either throws on update or
    // silently updates it while keeping it trashed (and the update response's
    // archived flag isn't reliable), so we detect via retrieve, not the update.
    let live = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = (await notion.pages.retrieve({ page_id: existingPageId })) as any;
      live = !existing.archived && !existing.in_trash;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not[ _]?found|could not find/i.test(msg)) throw err;
    }

    if (live) {
      // fullUpdate (Luma-driven): refresh ALL guest fields. Otherwise
      // (claim/status mirror): touch only status + booked-by.
      const properties = fullUpdate
        ? bookingToPageProperties(booking, opts)
        : syncedFieldsToUpdateProperties(pickSyncedFields(booking));
      await notion.pages.update({
        page_id: existingPageId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties: properties as any,
      });
      return "updated";
    }
    // Dead/archived card → fall through to create a fresh one.
  }

  // No usable stored id — adopt an existing card for this guest if one exists
  // (race guard / self-heal) rather than creating a duplicate.
  if (booking.luma_guest_id) {
    const found = await findCardByLumaGuestId(notion, workspace, booking.luma_guest_id);
    if (found) {
      await notion.pages.update({
        page_id: found,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties: bookingToPageProperties(booking, opts) as any,
      });
      await setNotionPageId(booking.id, workspace, found);
      return "updated";
    }
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
  opts: {
    dev?: PushOptions;
    ambassador?: PushOptions;
    skip?: NotionWorkspace[];
    /** Refresh all guest fields on existing cards (use for Luma-driven pushes). */
    fullUpdate?: boolean;
  } = {},
): Promise<PushResult> {
  const result: PushResult = { dev: "skipped", ambassador: "skipped" };
  const skip = new Set(opts.skip ?? []);

  for (const workspace of ["dev", "ambassador"] as const) {
    if (skip.has(workspace)) continue;
    try {
      result[workspace] = await pushToWorkspace(
        workspace,
        booking,
        opts[workspace] ?? {},
        opts.fullUpdate ?? false,
      );
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
