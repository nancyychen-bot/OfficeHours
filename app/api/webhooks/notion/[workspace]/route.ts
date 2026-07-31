import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isEcho } from "@/lib/sync/hash";
import type { NotionWorkspace } from "@/lib/notion/client";
import { getNotionClient } from "@/lib/notion/client";
import { pagePropertiesToSyncedFields, readFirstPersonEmail } from "@/lib/notion/mappers";
import { PROP } from "@/lib/notion/schema";
import {
  getBookingByNotionPageId,
  getBookingById,
  claimBooking,
  releaseBooking,
  setBookedByEmail,
} from "@/lib/db/bookings";
import { pushBookingToWorkspaces, clearBookingInWorkspaces } from "@/lib/notion/push";
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

  const raw = await req.text();
  let body: {
    page_id?: string;
    pageId?: string;
    id?: string;
    secret?: string;
    // Notion's "Send webhook" action nests the page under `data`.
    data?: { id?: string; properties?: Record<string, unknown> };
  } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    // Log the raw body so we can diagnose what Notion's automation actually sent.
    await logSync({
      direction,
      result: "error",
      action: "received",
      note: `invalid json body: ${raw.slice(0, 400)}`,
    });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Capture the FULL payload so we can adapt to Notion's actual "Send webhook"
  // shape (property picker, not custom JSON). Secret comes via a custom header.
  const secretHeader =
    req.headers.get("x-webhook-secret") ?? req.headers.get("x-office-hours-secret");
  await logSync({
    direction,
    result: "applied",
    action: "received",
    payload: body as never,
    note: `secret_hdr=${!!secretHeader} body_keys=${Object.keys(body).join(",") || "none"}`,
  });

  const secret = workspace === "dev" ? env.notionDev.webhookSecret() : env.notionAmbassador.webhookSecret();
  const provided = secretHeader ?? body.secret;
  if (secret && provided !== secret) {
    await logSync({ direction, result: "error", action: "verify", note: "bad secret" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Notion's "Send webhook" nests the page as `data` (data.id + data.properties).
  const pageId = body.data?.id ?? body.page_id ?? body.pageId ?? body.id;
  if (!pageId) {
    await logSync({ direction, result: "error", action: "received", payload: body as never, note: "no page id in payload" });
    return NextResponse.json({ error: "missing page id" }, { status: 400 });
  }

  // Explicit intent from the button, via header (robust against page-state
  // timing). "unclaim" → release; anything else → claim (default).
  const action = (req.headers.get("x-action") ?? "").toLowerCase();

  try {
    const booking = await getBookingByNotionPageId(workspace, pageId);
    if (!booking) {
      await logSync({ direction, result: "error", action: "resolve", note: `no booking for ${workspace} page ${pageId}` });
      return NextResponse.json({ received: true, warning: "unknown page" });
    }

    // UNCLAIM — explicit intent. Unconditionally release + fully clear BOTH
    // sides (status/name/type/person). No page fetch, no echo check, no
    // dependence on button-edit timing.
    if (action === "unclaim") {
      const released = (await releaseBooking(booking.id)) ?? booking;
      await clearBookingInWorkspaces(released);
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "unclaimed" });
      return NextResponse.json({ received: true });
    }

    // CLAIM / default — fetch the page for authoritative CURRENT state (the
    // button's payload can be a stale pre-edit snapshot).
    const notion = getNotionClient(workspace);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let page = (await notion.pages.retrieve({ page_id: pageId })) as any;
    let incoming = pagePropertiesToSyncedFields(page.properties ?? {});

    // Tolerate button step-ordering: if a Claim button sends its webhook before
    // its "Edit property" step commits, this first read shows a stale
    // "unassigned". Retry once so an in-flight claim isn't dropped as a no-op.
    if (incoming.status === "unassigned" && booking.status === "unassigned") {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page = (await notion.pages.retrieve({ page_id: pageId })) as any;
      incoming = pagePropertiesToSyncedFields(page.properties ?? {});
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
      const helperEmail = readFirstPersonEmail(page.properties?.[PROP.bookedByPerson]);
      if (helperEmail) await setBookedByEmail(claim.booking.id, helperEmail);
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
