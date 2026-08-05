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
  setLumaStatus,
  resetAssignment,
} from "@/lib/db/bookings";
import { getEventById } from "@/lib/db/events";
import { updateGuestStatus } from "@/lib/luma/client";
import { applyLumaStatus, type ApplyDeps } from "@/lib/sync/approval";
import type { SyncDirection } from "@/lib/sync/types";
import { pushBookingToWorkspaces, clearBookingInWorkspaces } from "@/lib/notion/push";
import { logSync } from "@/lib/sync/log";
import { sendBookingComms } from "@/lib/email/comms";

export const runtime = "nodejs";
export const maxDuration = 30; // allow the button-settle delay + processing

/** Build the applyLumaStatus dependencies for a Notion-origin approval change. */
function approvalDeps(direction: SyncDirection, bookingId: string): ApplyDeps {
  return {
    setLumaStatus,
    resetAssignment,
    pushToWorkspaces: (b) => pushBookingToWorkspaces(b),
    updateGuestOnLuma: (eventLumaId, guestLumaId, next) =>
      updateGuestStatus({ eventLumaId, guestLumaId, status: next }),
    sendComms: (bid, kind) => sendBookingComms(bid, kind),
    getEventLumaId: async (eventId) => (await getEventById(eventId))?.luma_event_id ?? null,
    log: async (e) =>
      logSync({ direction, result: e.error ? "error" : "applied", bookingId, action: e.action, note: e.note }),
  };
}

// This workspace's buttons fire their webhook BEFORE their "Edit property" step
// commits (and can't be reordered). So we wait this long for the button's edit
// to settle before the hub reads (claim) or writes the final state (unclaim) —
// otherwise the button's late edit races/overwrites the hub.
const BUTTON_EDIT_SETTLE_MS = 5000;

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
      // Wait for the button's own Edit step to settle, THEN clear both cards so
      // the hub's clear writes last and wins on the origin card too.
      await new Promise((resolve) => setTimeout(resolve, BUTTON_EDIT_SETTLE_MS));
      await clearBookingInWorkspaces(released);
      await sendBookingComms(booking.id, "expert_unavailable");
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "unclaimed" });
      return NextResponse.json({ received: true });
    }

    // CLAIM / default — the Claim button sends its webhook BEFORE its
    // "Edit property" step commits, and the step order can't be changed on this
    // workspace's buttons. So wait for the edit to land, THEN read the page's
    // authoritative state. (Unclaim/cancel/re-register don't read Notion state
    // after a button, so they're unaffected by this race.)
    await new Promise((resolve) => setTimeout(resolve, BUTTON_EDIT_SETTLE_MS));
    const notion = getNotionClient(workspace);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await notion.pages.retrieve({ page_id: pageId })) as any;
    const incoming = pagePropertiesToSyncedFields(page.properties ?? {});

    // Loop prevention (PRD §7.3): drop echoes of the hub's own last write.
    if (isEcho(incoming, booking.last_synced_hash)) {
      await logSync({ direction, result: "skipped_echo", bookingId: booking.id, action: "echo" });
      return NextResponse.json({ received: true, echo: true });
    }

    // APPROVAL CHANGE — Luma Status edited in Notion (property-diff, no button).
    if (incoming.luma_status !== booking.luma_status) {
      await applyLumaStatus(booking, incoming.luma_status, { source: workspace }, approvalDeps(direction, booking.id));
      await logSync({ direction, result: "applied", bookingId: booking.id, action: `luma_status:${incoming.luma_status}` });
      return NextResponse.json({ received: true });
    }

    // The Claim button reliably sets "Booked by" (the assignee) but may NOT flip
    // the Status select. So key the claim off the ASSIGNEE, not Status — the hub
    // owns Status and sets it everywhere. `claimer` = text mirror ?? Person name.
    const claimer = incoming.booked_by_display_name;

    // CLAIM — an open booking now has an assignee.
    if (booking.status === "unassigned" && claimer) {
      const claim = await claimBooking({
        bookingId: booking.id,
        displayName: claimer,
        bookedByType: incoming.booked_by_type ?? (workspace === "dev" ? "employee" : "ambassador"),
      });
      if (!claim.ok) {
        // Lost the race — re-push canonical state to BOTH sides to correct them.
        const current = claim.reason === "already_claimed" ? claim.current : await getBookingById(booking.id);
        if (current) await pushBookingToWorkspaces(current);
        await logSync({ direction, result: "applied", bookingId: booking.id, action: "claim_conflict", note: "already claimed" });
        return NextResponse.json({ received: true, conflict: true });
      }
      const helperEmail = readFirstPersonEmail(page.properties?.[PROP.bookedByPerson]);
      if (helperEmail) await setBookedByEmail(claim.booking.id, helperEmail);
      // Push to BOTH: flip Status → Assigned on the origin card too (the button
      // may not have) and mirror to the other workspace.
      await pushBookingToWorkspaces(claim.booking);
      // A claim triages an untriaged guest: pending -> approved (writes back to
      // Luma + mirrors). Deliberate waitlist/declined are left untouched.
      if (claim.booking.luma_status === "pending") {
        await applyLumaStatus(claim.booking, "approved", { source: workspace }, approvalDeps(direction, claim.booking.id));
      }
      await sendBookingComms(claim.booking.id, "assigned");
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "claimed" });
      return NextResponse.json({ received: true });
    }

    // RELEASE — an assigned booking had its assignee cleared (manual edit; the
    // Unclaim button path is handled earlier via X-Action).
    if (booking.status === "assigned" && !claimer) {
      const released = await releaseBooking(booking.id);
      if (released) await pushBookingToWorkspaces(released);
      if (released) await sendBookingComms(released.id, "expert_unavailable");
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "released" });
      return NextResponse.json({ received: true });
    }

    await logSync({ direction, result: "applied", bookingId: booking.id, action: `noop:${incoming.status}`, note: `claimer=${claimer ?? "none"}` });
    return NextResponse.json({ received: true });
  } catch (err) {
    await logSync({ direction, result: "error", action: "process", note: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ received: true, error: "processing failed" });
  }
}
