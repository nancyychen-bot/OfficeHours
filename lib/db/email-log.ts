import { getAdminClient } from "../supabase/admin";

export type CommsStatus = "pending" | "sent" | "failed" | "skipped";

// email_log isn't in the generated Database types yet; access it loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getAdminClient() as any).from("email_log");
}

// A `pending` row older than this is considered abandoned (a send that crashed
// between reserve and finalize) and becomes retryable — while a fresh `pending`
// (a concurrent in-flight send) is left alone so we never double-send.
const STALE_PENDING_MS = 10 * 60_000;
/** PostgREST `.or(...)` matching a retryable row: failed/skipped, or stale pending. */
function retryableFilter(): string {
  const cutoff = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  return `status.in.(failed,skipped),and(status.eq.pending,created_at.lt.${cutoff})`;
}

/**
 * Atomically reserve the send slot for (booking, kind, recipient EMAIL) — the
 * concurrency guard that makes sending (not just the ledger) idempotent. Keyed
 * on email, not role, so re-assigning a booking to a different helper notifies
 * the new helper (new email → new send) while the same recipient never gets a
 * duplicate. Returns true only to the caller that won the reservation.
 *
 * Two paths, both race-safe:
 *  1. First attempt: INSERT a `pending` row via upsert-ignore-duplicates. Only
 *     one concurrent caller gets the inserted row back; the rest get [].
 *  2. Retry of a prior attempt: a conditional UPDATE claims a row still in
 *     `failed`/`skipped` (a transient failure or a kill-switch skip). Postgres
 *     re-evaluates the WHERE after row-lock, so only one claimer flips it out of
 *     that state — the loser matches nothing and returns false. A `sent` or
 *     already-`pending` row matches neither path → false (no duplicate send).
 */
export async function reserveCommsSlot(
  bookingId: string,
  eventKind: string,
  role: string,
  email: string,
): Promise<boolean> {
  const { data: inserted, error: insErr } = await table()
    .upsert(
      {
        booking_id: bookingId,
        event_kind: eventKind,
        recipient_role: role,
        recipient_email: email,
        status: "pending",
        resend_id: null,
      },
      { onConflict: "booking_id,event_kind,recipient_email", ignoreDuplicates: true },
    )
    .select("id");
  if (insErr) throw insErr;
  if (inserted && inserted.length > 0) return true;

  // A row already exists for this email — claim it only if it's retryable
  // (failed/skipped, or a stale abandoned pending). A fresh pending (concurrent
  // in-flight send) is NOT reclaimed, so we never double-send.
  const { data: claimed, error: updErr } = await table()
    .update({ status: "pending", recipient_role: role, resend_id: null })
    .eq("booking_id", bookingId)
    .eq("event_kind", eventKind)
    .eq("recipient_email", email)
    .or(retryableFilter())
    .select("id");
  if (updErr) throw updErr;
  return !!(claimed && claimed.length > 0);
}

/**
 * Distinct (booking_id, event_kind) pairs that still have a `failed` recipient —
 * a transient send failure that nothing has re-driven. The retry cron re-invokes
 * sendBookingComms for each, and reserveCommsSlot reclaims the failed row.
 */
export async function listRetriableComms(): Promise<Array<{ bookingId: string; kind: string }>> {
  const { data, error } = await table()
    .select("booking_id, event_kind")
    .or(retryableFilter());
  if (error) throw error;
  const seen = new Set<string>();
  const out: Array<{ bookingId: string; kind: string }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data ?? []) as any[]) {
    const key = `${r.booking_id}:${r.event_kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bookingId: r.booking_id as string, kind: r.event_kind as string });
  }
  return out;
}

/**
 * Delete the send records for a booking + kinds, so those emails can be sent
 * again as a NEW episode. Used on (re)claim: a guest going claimed → waitlist →
 * claimed (or claimed → self-cancel → re-register → claimed) should get a fresh
 * invite, which the per-booking dedup would otherwise suppress.
 */
export async function clearCommsForKinds(bookingId: string, kinds: string[]): Promise<void> {
  if (kinds.length === 0) return;
  const { error } = await table().delete().eq("booking_id", bookingId).in("event_kind", kinds);
  if (error) throw error;
}

/** True if this Resend id belongs to one of OUR sends (ledger row exists). Scopes
 * the email-log content viewer to this app's emails, not the whole Resend account. */
export async function isOwnResendId(resendId: string): Promise<boolean> {
  const { data, error } = await table().select("id").eq("resend_id", resendId).limit(1);
  if (error) throw error;
  return !!(data && data.length > 0);
}

/** True if the `assigned` email to this helper has a ledger row (any status) —
 * i.e. comms were at least attempted. Used to gate the claim self-heal. */
export async function hasAssignedCommsFor(bookingId: string, helperEmail: string): Promise<boolean> {
  const { data, error } = await table()
    .select("id")
    .eq("booking_id", bookingId)
    .eq("event_kind", "assigned")
    .eq("recipient_role", "helper")
    .ilike("recipient_email", helperEmail)
    .limit(1);
  if (error) throw error;
  return !!(data && data.length > 0);
}

/** Every `assigned`/helper ledger row as (bookingId, email) — the "already
 * attempted" set the comms-reconcile backstop diffs assigned bookings against. */
export async function listAssignedHelperCommRows(): Promise<Array<{ bookingId: string; email: string }>> {
  const { data, error } = await table()
    .select("booking_id, recipient_email")
    .eq("event_kind", "assigned")
    .eq("recipient_role", "helper");
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter((r) => r.recipient_email)
    .map((r) => ({ bookingId: r.booking_id as string, email: r.recipient_email as string }));
}

/** Delete ALL send records for a booking — used on reactivation (re-registration
 * of a cancelled booking) so the whole next episode can re-send. */
export async function clearAllComms(bookingId: string): Promise<void> {
  const { error } = await table().delete().eq("booking_id", bookingId);
  if (error) throw error;
}

/** Finalize a reserved slot (keyed on recipient email) with its terminal status. */
export async function finalizeComms(
  bookingId: string,
  eventKind: string,
  email: string,
  outcome: { resendId: string | null; status: CommsStatus },
): Promise<void> {
  const { error } = await table()
    .update({ status: outcome.status, resend_id: outcome.resendId })
    .eq("booking_id", bookingId)
    .eq("event_kind", eventKind)
    .eq("recipient_email", email);
  if (error) throw error;
}
