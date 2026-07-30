import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isEcho } from "@/lib/sync/hash";
import type { NotionWorkspace } from "@/lib/notion/client";
import { getNotionClient } from "@/lib/notion/client";
import { pagePropertiesToSyncedFields } from "@/lib/notion/mappers";
import {
  getBookingByNotionPageId,
  getBookingById,
  claimBooking,
  releaseBooking,
} from "@/lib/db/bookings";
import { pushBookingToWorkspaces } from "@/lib/notion/push";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";

/**
 * Notion → hub webhook (PRD §7.3 / §8.4). One route per workspace via the
 * `[workspace]` segment (`/dev` or `/ambassador`).
 *
 * We control the automation's payload, so configure the Notion "Send webhook"
 * action to POST `{ "page_id": "<Page ID>", "secret": "<shared>" }`. We then
 * fetch the page via the API (source of truth for its current props) rather than
 * trusting the customizable webhook body.
 *
 * Flow: verify secret → fetch page → loop-prevention (drop echoes of our own
 * writes) → apply the human change (claim arbiter for unassigned→assigned; or
 * release) → push the resulting state to the OTHER workspace.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ workspace: string }> },
) {
  const { workspace: ws } = await params;
  if (ws !== "dev" && ws !== "ambassador") {
    return NextResponse.json({ error: "unknown workspace" }, { status: 404 });
  }
  const workspace = ws as NotionWorkspace;
  const direction = workspace === "dev" ? "notion_dev_in" : "notion_amb_in";
  const other: NotionWorkspace = workspace === "dev" ? "ambassador" : "dev";

  let body: { page_id?: string; pageId?: string; id?: string; secret?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const secret = workspace === "dev" ? env.notionDev.webhookSecret() : env.notionAmbassador.webhookSecret();
  if (secret && body.secret !== secret) {
    await logSync({ direction, result: "error", action: "verify", note: "bad secret" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pageId = body.page_id ?? body.pageId ?? body.id;
  if (!pageId) {
    await logSync({ direction, result: "error", action: "received", payload: body as never, note: "no page_id in payload" });
    return NextResponse.json({ error: "missing page_id" }, { status: 400 });
  }

  try {
    // Fetch the page's current properties from Notion (authoritative).
    const notion = getNotionClient(workspace);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await notion.pages.retrieve({ page_id: pageId })) as any;
    const incoming = pagePropertiesToSyncedFields(page.properties ?? {});

    const booking = await getBookingByNotionPageId(workspace, pageId);
    if (!booking) {
      await logSync({ direction, result: "error", action: "resolve", note: `no booking for ${workspace} page ${pageId}` });
      return NextResponse.json({ received: true, warning: "unknown page" });
    }

    // Loop prevention (PRD §7.3): drop echoes of the hub's own last write.
    if (isEcho(incoming, booking.last_synced_hash)) {
      await logSync({ direction, result: "skipped_echo", bookingId: booking.id, action: "echo" });
      return NextResponse.json({ received: true, echo: true });
    }

    // Apply the human change.
    if (incoming.status === "assigned" && booking.status === "unassigned") {
      const claim = await claimBooking({
        bookingId: booking.id,
        displayName: incoming.booked_by_display_name ?? "Unknown",
        bookedByType: incoming.booked_by_type ?? (workspace === "dev" ? "employee" : "ambassador"),
      });
      if (!claim.ok) {
        // Lost the race — revert this workspace's page to canonical state.
        const current = claim.reason === "already_claimed" ? claim.current : await getBookingById(booking.id);
        if (current) {
          await pushBookingToWorkspaces(current, { skip: [other] });
        }
        await logSync({ direction, result: "applied", bookingId: booking.id, action: "claim_conflict", note: "already claimed; reverted origin" });
        return NextResponse.json({ received: true, conflict: true });
      }
      await pushBookingToWorkspaces(claim.booking, { skip: [workspace] });
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "claimed" });
      return NextResponse.json({ received: true });
    }

    if (incoming.status === "unassigned" && booking.status === "assigned") {
      const released = await releaseBooking(booking.id);
      if (released) await pushBookingToWorkspaces(released, { skip: [workspace] });
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "released" });
      return NextResponse.json({ received: true });
    }

    // Other transitions (e.g. no_show set manually) are not mirrored back yet.
    await logSync({ direction, result: "applied", bookingId: booking.id, action: `noop:${incoming.status}`, note: "no reconciliation rule" });
    return NextResponse.json({ received: true });
  } catch (err) {
    await logSync({ direction, result: "error", action: "process", note: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ received: true, error: "processing failed" });
  }
}
