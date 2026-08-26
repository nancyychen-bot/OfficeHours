import { NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { constantTimeEquals } from "@/lib/auth/token";
import { isEcho } from "@/lib/sync/hash";
import type { NotionWorkspace } from "@/lib/notion/client";
import { getNotionClient } from "@/lib/notion/client";
import { pagePropertiesToSyncedFields, readFirstPersonEmail, readFirstPersonName, readSlotLabelFromPage } from "@/lib/notion/mappers";
import { PROP } from "@/lib/notion/schema";
import {
  getBookingByNotionPageId,
  getBookingById,
  claimBooking,
  reassignBooking,
  releaseBooking,
  setBookedByEmail,
  setBookingSlot,
  helperHasSlotConflict,
  setLumaStatus,
  resetAssignment,
} from "@/lib/db/bookings";
import { matchSlotForEvent } from "@/lib/db/slots";
import { getEventById, getEventByLumaId } from "@/lib/db/events";
import { updateGuestStatus } from "@/lib/luma/client";
import { apiKeyForCalendar } from "@/lib/luma/calendars";
import { applyLumaStatus, type ApplyDeps } from "@/lib/sync/approval";
import type { SyncDirection } from "@/lib/sync/types";
import { pushBookingToWorkspaces, clearBookingInWorkspaces, clearUnclaimRequestedByInWorkspaces } from "@/lib/notion/push";
import { isUnclaimAdmin } from "@/lib/auth/admins";
import { logSync } from "@/lib/sync/log";
import { sendBookingComms, sendCommsToEmail } from "@/lib/email/comms";
import { clearCommsForKinds, hasAssignedCommsFor } from "@/lib/db/email-log";
import { postSlackRecruit, postSlackClaimed } from "@/lib/slack/client";
import { postClaimConfirmDM } from "@/lib/slack/notify";

export const runtime = "nodejs";
// Budget for the button-settle delay + serial Notion/Resend/Luma/Slack calls.
// A claim that overruns this leaves the DB assigned but comms unsent; the
// comms-retry cron backstops that, but a wider margin makes it far rarer.
export const maxDuration = 90;

/** Build the applyLumaStatus dependencies for a Notion-origin approval change. */
function approvalDeps(direction: SyncDirection, bookingId: string): ApplyDeps {
  return {
    setLumaStatus,
    resetAssignment,
    pushToWorkspaces: (b) => pushBookingToWorkspaces(b),
    updateGuestOnLuma: async (eventLumaId, guestLumaId, next) => {
      const cal = (await getEventByLumaId(eventLumaId))?.luma_calendar;
      await updateGuestStatus({ eventLumaId, guestLumaId, status: next, apiKey: apiKeyForCalendar(cal) });
    },
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
  if (secret && !constantTimeEquals(provided ?? "", secret)) {
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

  // Acknowledge Notion immediately so the button's "Send webhook" step doesn't
  // show a "webhook timed out" warning. The real work — a 5s settle for Notion's
  // own edit to land, then the claim/unclaim/reassign handling — runs AFTER the
  // response via after() (Vercel Fluid Compute keeps the function alive). Notion
  // never consumed the handler's response body anyway; state is mirrored back to
  // the cards separately.
  after(() => processNotionWebhook(workspace, direction, pageId, action));
  return NextResponse.json({ received: true });
}

/**
 * The actual Notion→hub processing, run off the response path. Its NextResponse
 * returns go nowhere (Notion already got its 200) — kept as-is for readability.
 * Never throws (best-effort sync); failures are logged.
 */
async function processNotionWebhook(
  workspace: NotionWorkspace,
  direction: SyncDirection,
  pageId: string,
  action: string,
): Promise<unknown> {
  try {
    const booking = await getBookingByNotionPageId(workspace, pageId);
    if (!booking) {
      await logSync({ direction, result: "error", action: "resolve", note: `no booking for ${workspace} page ${pageId}` });
      return NextResponse.json({ received: true, warning: "unknown page" });
    }

    // UNCLAIM — explicit intent, but AUTHORISED: only the current claimer may
    // release their own spot (plus admins, who may release any). The Unclaim
    // button sets "Unclaim requested by" = Whoever clicked; that identity is the
    // authorisation. The button fires the webhook before its edit commits, so we
    // wait, then read the page to see who actually clicked.
    if (action === "unclaim") {
      await new Promise((resolve) => setTimeout(resolve, BUTTON_EDIT_SETTLE_MS));
      const notionU = getNotionClient(workspace);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pageU = (await notionU.pages.retrieve({ page_id: pageId })) as any;
      const requesterName = readFirstPersonName(pageU.properties?.[PROP.unclaimRequestedBy]);
      const requesterEmail = readFirstPersonEmail(pageU.properties?.[PROP.unclaimRequestedBy]);
      const isAdmin = await isUnclaimAdmin(requesterEmail);
      const isClaimer =
        (!!requesterEmail && !!booking.booked_by_email && requesterEmail.toLowerCase() === booking.booked_by_email.toLowerCase()) ||
        (!!requesterName && !!booking.booked_by_display_name && requesterName === booking.booked_by_display_name);

      if (!isAdmin && !isClaimer) {
        // Not the claimer (or admin) → refuse. Keep the claim, revert their stray
        // chip, and tell them (if we could read their email).
        if (requesterEmail) await sendCommsToEmail(booking.id, "unclaim_denied", "helper", requesterEmail);
        await clearUnclaimRequestedByInWorkspaces(booking);
        await logSync({ direction, result: "applied", bookingId: booking.id, action: "unclaim_denied", note: requesterName ?? "unknown" });
        return NextResponse.json({ received: true, denied: true });
      }

      // Authorised → notify the released expert (+ drop their calendar hold), then
      // release and fully clear BOTH cards (also clears "Unclaim requested by").
      await sendBookingComms(booking.id, "expert_unavailable");
      const released = (await releaseBooking(booking.id)) ?? booking;
      await clearBookingInWorkspaces(released);
      // Recruit a replacement in the city's Slack channel (best-effort, no-op if unset).
      await postSlackRecruit(booking.id);
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "unclaimed", note: isAdmin ? `admin:${requesterName ?? requesterEmail}` : undefined });
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

    // MANUAL SLOT EDIT — the "Slot" text was changed by hand in Notion. Slot
    // isn't part of the synced-fields hash, so a slot-only edit looks like an
    // echo; handle it BEFORE the echo guard. Re-bind the booking to the matched
    // slot, re-issue the calendar invite (if assigned), and mirror to both cards.
    // Requires a Notion automation on the "Slot" property → this webhook.
    const incomingSlotLabel = readSlotLabelFromPage(page.properties ?? {});
    const matchedSlot = incomingSlotLabel
      ? await matchSlotForEvent({ eventId: booking.event_id, requestedLabel: incomingSlotLabel })
      : null;
    if (matchedSlot && matchedSlot.id !== booking.slot_id) {
      const updated = (await setBookingSlot(booking.id, matchedSlot.id)) ?? booking;
      const ev = await getEventById(booking.event_id);
      if (updated.status === "assigned") {
        // Fresh time → re-send the invite (monotonic ICS SEQUENCE updates the hold).
        await clearCommsForKinds(updated.id, ["assigned"]);
        await sendBookingComms(updated.id, "assigned");
        await postClaimConfirmDM(updated.id);
      }
      const pushOpts = { slotLabel: matchedSlot.name, location: ev?.city, eventName: ev?.name, eventDate: ev?.event_date };
      await pushBookingToWorkspaces(updated, { fullUpdate: true, dev: pushOpts, ambassador: pushOpts });
      await logSync({ direction, result: "applied", bookingId: booking.id, action: `slot_changed:${matchedSlot.name}` });
      return NextResponse.json({ received: true });
    }

    // REASSIGN — the organizer changed "Booked by" (Person) on an already-assigned
    // booking to a DIFFERENT expert. The text mirror still shows the old name (so
    // this would otherwise read as an echo), and the mirror workspace's Person is
    // cleared by the hub — so a differing Person here is a genuine, human reassign.
    const other: NotionWorkspace = workspace === "dev" ? "ambassador" : "dev";
    const personName = readFirstPersonName(page.properties?.[PROP.bookedByPerson]);

    // ALREADY CLAIMED — someone clicked Claim (X-Action: claim) on a slot that's
    // already assigned to someone else. Tell them it's taken; keep the original.
    if (action === "claim" && booking.status === "assigned" && personName && personName !== booking.booked_by_display_name) {
      const clickerEmail = readFirstPersonEmail(page.properties?.[PROP.bookedByPerson]);
      // Revert their stray chip on both sides FIRST — this is fast and deterministic,
      // and the concurrent reassign webhook's 3s re-verify must see the revert and
      // no-op. Emailing first would let variable Resend latency delay the revert past
      // that window and wrongly hand the slot to the intruder. THEN email.
      await pushBookingToWorkspaces(booking, { clearPersonOn: ["dev", "ambassador"] });
      if (clickerEmail) await sendCommsToEmail(booking.id, "already_claimed", "helper", clickerEmail);
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "claim_rejected_taken", note: personName });
      return NextResponse.json({ received: true, conflict: true });
    }

    // REASSIGN — you changed "Booked by" on an assigned booking (X-Action: reassign).
    // Requires the explicit action so a Claim button can never reassign a taken slot.
    if (action === "reassign" && booking.status === "assigned" && personName && personName !== booking.booked_by_display_name) {
      // Re-verify after a beat so a concurrent claim-reject (which clears the stray
      // chip) settles first — we never reassign to someone who was just rejected.
      await new Promise((r) => setTimeout(r, 3000));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fresh = (await notion.pages.retrieve({ page_id: pageId })) as any;
      const freshPerson = readFirstPersonName(fresh.properties?.[PROP.bookedByPerson]);
      const freshBooking = (await getBookingById(booking.id)) ?? booking;
      if (!freshPerson || freshBooking.status !== "assigned" || freshPerson === freshBooking.booked_by_display_name) {
        await logSync({ direction, result: "applied", bookingId: booking.id, action: "reassign_noop" });
        return NextResponse.json({ received: true });
      }
      // Tell the PREVIOUS expert first (reads current DB = old expert) + drop their hold.
      await sendBookingComms(freshBooking.id, "reassigned_off");
      const type = incoming.booked_by_type ?? freshBooking.booked_by_type ?? (workspace === "dev" ? "employee" : "ambassador");
      const updated = (await reassignBooking(freshBooking.id, freshPerson, type)) ?? freshBooking;
      const helperEmail = readFirstPersonEmail(fresh.properties?.[PROP.bookedByPerson]);
      if (helperEmail) {
        await setBookedByEmail(updated.id, helperEmail);
        if (await helperHasSlotConflict(updated.id, helperEmail, updated.slot_id)) {
          await sendBookingComms(updated.id, "double_booked");
        }
      }
      // Fresh assignment → new expert + guest get the invite (updated with the new
      // expert's name); clear the prior 'assigned' send so the dedup doesn't suppress it.
      await clearCommsForKinds(updated.id, ["assigned"]);
      await sendBookingComms(updated.id, "assigned");
      await postClaimConfirmDM(updated.id);
      const current = (await getBookingById(updated.id)) ?? updated;
      await pushBookingToWorkspaces(current, { clearPersonOn: [other] });
      await logSync({ direction, result: "applied", bookingId: booking.id, action: `reassigned:${freshPerson}` });
      return NextResponse.json({ received: true });
    }

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
        // Lost the race, or the booking is filtered (hidden + not claimable) —
        // re-push canonical state to BOTH sides so the stray Claim chip reverts.
        const current =
          claim.reason === "already_claimed" || claim.reason === "filtered"
            ? claim.current
            : await getBookingById(booking.id);
        if (current) await pushBookingToWorkspaces(current);
        await logSync({
          direction, result: "applied", bookingId: booking.id, action: "claim_conflict",
          note: claim.reason === "filtered" ? "filtered — not claimable" : "already claimed",
        });
        return NextResponse.json({ received: true, conflict: true });
      }
      const helperEmail = readFirstPersonEmail(page.properties?.[PROP.bookedByPerson]);
      if (helperEmail) {
        await setBookedByEmail(claim.booking.id, helperEmail);
        // Double-book guard: same expert already holds another guest in this slot
        // (multiple guests per slot are allowed, but one expert can't meet two at
        // once) → warn them so they can unclaim one.
        if (await helperHasSlotConflict(claim.booking.id, helperEmail, claim.booking.slot_id)) {
          await sendBookingComms(claim.booking.id, "double_booked");
          await logSync({ direction, result: "applied", bookingId: claim.booking.id, action: "double_booked" });
        }
      }
      // Push to BOTH: flip Status → Assigned on the origin card too (the button
      // may not have) and mirror to the other workspace. Clear the mirror's Person
      // chip so it never holds a stale assignee (text mirror carries the name).
      await pushBookingToWorkspaces(claim.booking, { clearPersonOn: [other] });
      // A claim pulls a guest in: pending OR waitlisted -> approved (writes back
      // to Luma + mirrors). Already-approved guests are left as-is.
      if (claim.booking.luma_status === "pending" || claim.booking.luma_status === "waitlist") {
        await applyLumaStatus(claim.booking, "approved", { source: workspace }, approvalDeps(direction, claim.booking.id));
      }
      // A (re)claim is a fresh assignment: clear any prior 'assigned' send so a
      // guest cycling claimed → waitlist/cancel → claimed gets a new invite
      // (the per-booking dedup would otherwise suppress it).
      await clearCommsForKinds(claim.booking.id, ["assigned"]);
      await sendBookingComms(claim.booking.id, "assigned");
      await postClaimConfirmDM(claim.booking.id);
      // If this slot was recruited in Slack, tell the channel it's covered (no-op otherwise).
      await postSlackClaimed(claim.booking.id);
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "claimed" });
      return NextResponse.json({ received: true });
    }

    // RELEASE — an assigned booking had its assignee cleared (manual edit; the
    // Unclaim button path is handled earlier via X-Action).
    if (booking.status === "assigned" && !claimer) {
      // Email BEFORE releasing so the guest + prior helper get the cancel .ics
      // (release clears booked_by_email).
      await sendBookingComms(booking.id, "expert_unavailable");
      const released = await releaseBooking(booking.id);
      if (released) await pushBookingToWorkspaces(released);
      // Recruit a replacement in the city's Slack channel (best-effort, no-op if unset).
      await postSlackRecruit(booking.id);
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "released" });
      return NextResponse.json({ received: true });
    }

    // SELF-HEAL — the booking is already assigned to this same claimer, but a
    // prior claim webhook committed the assignment then died before sending comms
    // (e.g. hit the function timeout). This re-fire (Notion buttons often fire
    // twice) re-drives the missing side-effects once. Gated on the assigned comm
    // having no ledger row, so it's a no-op on a normal echo.
    if (
      booking.status === "assigned" &&
      booking.booked_by_email &&
      claimer?.trim() === (booking.booked_by_display_name ?? "").trim() &&
      !(await hasAssignedCommsFor(booking.id, booking.booked_by_email))
    ) {
      await sendBookingComms(booking.id, "assigned");
      await postClaimConfirmDM(booking.id);
      await postSlackClaimed(booking.id);
      await logSync({ direction, result: "applied", bookingId: booking.id, action: "claim_comms_healed" });
      return NextResponse.json({ received: true, healed: true });
    }

    await logSync({ direction, result: "applied", bookingId: booking.id, action: `noop:${incoming.status}`, note: `claimer=${claimer ?? "none"}` });
    return NextResponse.json({ received: true });
  } catch (err) {
    await logSync({ direction, result: "error", action: "process", note: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ received: true, error: "processing failed" });
  }
}
