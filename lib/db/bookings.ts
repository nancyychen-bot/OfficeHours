import { getAdminClient } from "../supabase/admin";
import { hashSyncedFields } from "../sync/hash";
import { noShowCutoffISO } from "../sync/noshow";
import { pickSyncedFields, type BookedByType, type Booking, type BookingDetails, type BookingStatus, type LumaStatus } from "../sync/types";

/**
 * Data-access + core state machine for bookings — the record mirrored across
 * both Notion workspaces (PRD §6.3). All writes go through the hub, which is the
 * arbiter for contended transitions (PRD §13).
 */

export async function getBookingById(id: string): Promise<Booking | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Fetch the enriched booking_details row (joins event + slot) by booking id. */
export async function getBookingDetailsById(id: string): Promise<BookingDetails | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("booking_details")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getBookingByLumaGuestId(lumaGuestId: string): Promise<Booking | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("luma_guest_id", lumaGuestId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getBookingByNotionPageId(
  workspace: "dev" | "ambassador",
  pageId: string,
): Promise<Booking | null> {
  const supabase = getAdminClient();
  const column = workspace === "dev" ? "notion_dev_page_id" : "notion_ambassador_page_id";
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq(column, pageId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Decide the assignment-status patch for a Luma upsert. Pure + unit-tested.
 *
 * - Declined (Luma "Not Going" / cancelled) → `cancelled`, slot + helper cleared,
 *   so a guest who isn't coming is never claimable (idempotent if already cancelled).
 * - New going/pending guest → open for claiming: `unassigned` if they requested a
 *   1:1 slot, else `no_help_needed`.
 * - Waitlisted + already claimed → release the helper (slot kept in case they're
 *   approved later). Claimability itself is gated in `claimBooking` on luma_status,
 *   so a waitlisted guest can't be re-claimed even while `unassigned`.
 * - Previously-cancelled guest who re-registers (and isn't declined) → reactivate
 *   to the open status with the assignee cleared.
 * - Otherwise (active) → leave assignment untouched; a slot/answer edit must never
 *   un-claim an active booking.
 */
export function decideBookingStatusPatch(
  existingStatus: BookingStatus | null,
  lumaStatus: LumaStatus,
  requestedSlot: string | null | undefined,
): {
  status?: BookingStatus;
  slot_id?: null;
  booked_by_display_name?: null;
  booked_by_type?: null;
  booked_by_email?: null;
} {
  const openStatus: BookingStatus = requestedSlot ? "unassigned" : "no_help_needed";
  if (lumaStatus === "declined") {
    if (existingStatus === "cancelled") return {};
    return { status: "cancelled", slot_id: null, booked_by_display_name: null, booked_by_type: null, booked_by_email: null };
  }
  if (existingStatus === null) return { status: openStatus };
  if (lumaStatus === "waitlist") {
    return existingStatus === "assigned"
      ? { status: openStatus, booked_by_display_name: null, booked_by_type: null, booked_by_email: null }
      : {};
  }
  if (existingStatus === "cancelled") {
    return { status: openStatus, booked_by_display_name: null, booked_by_type: null, booked_by_email: null };
  }
  return {};
}

/**
 * Create or update a booking from a Luma registration (PRD §8.1). Matched on
 * `luma_guest_id` so a `guest.updated` webhook (e.g. slot change) updates the
 * same row rather than creating a duplicate. Assignment transitions are decided
 * by `decideBookingStatusPatch` (declined → cancelled/non-claimable, etc.);
 * an active booking's claim is otherwise never disturbed here.
 */
export async function upsertBookingFromLuma(input: {
  lumaGuestId: string;
  eventId: string;
  slotId: string | null;
  guestName: string;
  guestEmail: string;
  guestPhone?: string | null;
  role?: string | null;
  company?: string | null;
  challenge?: string | null;
  notionEmail?: string | null;
  notionPlan?: string | null;
  experienceLevel?: string | null;
  attendReasons?: string | null;
  requestedSlot?: string | null;
  lumaStatus: import("../sync/types").LumaStatus;
}): Promise<Booking> {
  const supabase = getAdminClient();
  const existing = await getBookingByLumaGuestId(input.lumaGuestId);
  const statusPatch = decideBookingStatusPatch(
    existing?.status ?? null,
    input.lumaStatus,
    input.requestedSlot,
  );
  const row = {
    luma_guest_id: input.lumaGuestId,
    event_id: input.eventId,
    slot_id: input.slotId,
    guest_name: input.guestName,
    guest_email: input.guestEmail,
    guest_phone: input.guestPhone ?? null,
    role: input.role ?? null,
    company: input.company ?? null,
    challenge: input.challenge ?? null,
    notion_email: input.notionEmail ?? null,
    notion_plan: input.notionPlan ?? null,
    experience_level: input.experienceLevel ?? null,
    attend_reasons: input.attendReasons ?? null,
    requested_slot: input.requestedSlot ?? null,
    luma_status: input.lumaStatus,
    // Assignment transitions (declined→cancelled, reactivate, open-for-claim);
    // spread last so it wins over the plain slot_id above when clearing.
    ...statusPatch,
  };
  const first = await supabase
    .from("bookings")
    .upsert(row, { onConflict: "luma_guest_id" })
    .select("*")
    .single();
  if (!first.error) return first.data;

  // Slot already taken by another guest → keep the booking, drop the slot.
  if (first.error.code === "23505" && input.slotId) {
    const retry = await supabase
      .from("bookings")
      .upsert({ ...row, slot_id: null }, { onConflict: "luma_guest_id" })
      .select("*")
      .single();
    if (retry.error) throw retry.error;
    return retry.data;
  }
  throw first.error;
}

export type ClaimResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_claimed"; current: Booking };

/**
 * THE ARBITER (PRD §13). First claim to reach the hub wins.
 *
 * The transition unassigned → assigned is a single conditional UPDATE guarded by
 * `status = 'unassigned'`. Postgres row locking makes this atomic, so two
 * helpers racing within the sync propagation window can't both succeed — the
 * loser gets `already_claimed` and the hub reverts their Notion page.
 *
 * Also gated on `luma_status IN (pending, approved)`: a waitlisted or declined
 * guest is never claimable (a claim of a pending guest auto-approves them).
 */
export async function claimBooking(params: {
  bookingId: string;
  displayName: string;
  bookedByType: BookedByType;
}): Promise<ClaimResult> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({
      status: "assigned",
      booked_by_display_name: params.displayName,
      booked_by_type: params.bookedByType,
    })
    .eq("id", params.bookingId)
    .eq("status", "unassigned") // <-- the guard that makes this first-wins
    .in("luma_status", ["pending", "approved"]) // waitlisted/declined can't be claimed
    .select("*")
    .maybeSingle();
  if (error) throw error;

  if (data) return { ok: true, booking: data };

  // No row updated: either it doesn't exist, or it was already claimed.
  const current = await getBookingById(params.bookingId);
  if (!current) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "already_claimed", current };
}

/** Revert a claim back to open (used for the losing side of a race, or admin). */
export async function releaseBooking(bookingId: string): Promise<Booking | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({
      status: "unassigned",
      booked_by_display_name: null,
      booked_by_type: null,
      booked_by_email: null,
    })
    .eq("id", bookingId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Flip to Checked In when the guest scans in at the Luma door (PRD §9.2).
 * Idempotent, and independent of assignment — a guest can be checked in whether
 * or not a helper has claimed them.
 */
export async function checkInByLumaGuestId(lumaGuestId: string): Promise<Booking | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "checked_in" })
    .eq("luma_guest_id", lumaGuestId)
    .neq("status", "checked_in")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Time-based No-show sweep (PRD §9.4): any booking whose slot STARTED more than
 * NO_SHOW_GRACE_MINUTES ago and that never reached Checked In is marked No-show.
 * Keyed off each booking's own slot start (absolute UTC instant), so it's
 * per-booking and timezone-correct — never the event's overall time. Returns
 * updated rows.
 */
export async function markNoShowsForStartedSlots(now: Date = new Date()): Promise<Booking[]> {
  const supabase = getAdminClient();
  // Candidate slots: started more than the grace period ago.
  const { data: startedSlots, error: slotErr } = await supabase
    .from("slots")
    .select("id")
    .lt("starts_at", noShowCutoffISO(now));
  if (slotErr) throw slotErr;
  const slotIds = (startedSlots ?? []).map((s) => s.id);
  if (slotIds.length === 0) return [];

  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "no_show" })
    .in("slot_id", slotIds)
    .in("status", ["unassigned", "assigned"])
    .select("*");
  if (error) throw error;
  return data ?? [];
}

/**
 * Stamp `last_synced_hash` / `last_synced_at` after the hub pushes a booking's
 * synced fields to a Notion workspace (PRD §7.3 loop prevention). Store the hash
 * of the state we just wrote so a subsequent echo webhook can be recognized.
 */
export async function stampSynced(bookingId: string, snapshot: Booking): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("bookings")
    .update({
      last_synced_hash: hashSyncedFields(pickSyncedFields(snapshot)),
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", bookingId);
  if (error) throw error;
}

/** Record the Notion page id created for a booking in a given workspace. */
export async function setNotionPageId(
  bookingId: string,
  workspace: "dev" | "ambassador",
  pageId: string,
): Promise<void> {
  const supabase = getAdminClient();
  const update =
    workspace === "dev"
      ? { notion_dev_page_id: pageId }
      : { notion_ambassador_page_id: pageId };
  const { error } = await supabase.from("bookings").update(update).eq("id", bookingId);
  if (error) throw error;
}

export async function listBookingsForEvent(eventId: string): Promise<Booking[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Cancel a booking outright: mark cancelled and release slot + helper. */
export async function cancelBooking(bookingId: string): Promise<Booking | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      slot_id: null,
      booked_by_display_name: null,
      booked_by_type: null,
      booked_by_email: null,
    })
    .eq("id", bookingId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Store the assigned helper's email (from their Notion Person) for notifications. */
export async function setBookedByEmail(bookingId: string, email: string): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("bookings")
    .update({ booked_by_email: email })
    .eq("id", bookingId);
  if (error) throw error;
}

/** Update only the approval axis. Returns the updated row. */
export async function setLumaStatus(
  bookingId: string,
  next: import("../sync/types").LumaStatus,
): Promise<Booking | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({ luma_status: next })
    .eq("id", bookingId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Reset the assignment axis on an approval downgrade: clear helper + slot and set
 * the assignment status back to open. `toStatus` is 'unassigned' if the guest had
 * requested a slot, else 'no_help_needed'.
 */
export async function resetAssignment(
  bookingId: string,
  toStatus: "unassigned" | "no_help_needed",
): Promise<Booking | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({
      status: toStatus,
      slot_id: null,
      booked_by_display_name: null,
      booked_by_type: null,
      booked_by_email: null,
    })
    .eq("id", bookingId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}
