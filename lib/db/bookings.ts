import { getAdminClient } from "../supabase/admin";
import { hashSyncedFields } from "../sync/hash";
import { noShowCutoffISO } from "../sync/noshow";
import { pickSyncedFields, type BookedByType, type Booking } from "../sync/types";

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
 * Create or update a booking from a Luma registration (PRD §8.1). Matched on
 * `luma_guest_id` so a `guest.updated` webhook (e.g. slot change) updates the
 * same row rather than creating a duplicate. Only guest-supplied fields are
 * touched here — never `status` or the `booked_by_*` fields, which are owned by
 * the claim flow.
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
}): Promise<Booking> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .upsert(
      {
        luma_guest_id: input.lumaGuestId,
        event_id: input.eventId,
        slot_id: input.slotId,
        guest_name: input.guestName,
        guest_email: input.guestEmail,
        guest_phone: input.guestPhone ?? null,
        role: input.role ?? null,
        company: input.company ?? null,
        challenge: input.challenge ?? null,
      },
      { onConflict: "luma_guest_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
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
 * Time-based No-show sweep (PRD §9.4): any booking whose slot has ended and that
 * never reached Checked In is marked No-show for reporting. Returns updated rows.
 */
export async function markNoShowsForEndedSlots(now: Date = new Date()): Promise<Booking[]> {
  const supabase = getAdminClient();
  // Find candidate slots that have ended.
  const { data: endedSlots, error: slotErr } = await supabase
    .from("slots")
    .select("id")
    .lt("ends_at", noShowCutoffISO(now));
  if (slotErr) throw slotErr;
  const slotIds = (endedSlots ?? []).map((s) => s.id);
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
