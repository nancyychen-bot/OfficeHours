import { getAdminClient } from "../supabase/admin";

export type CommsStatus = "pending" | "sent" | "failed" | "skipped";

// email_log isn't in the generated Database types yet; access it loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getAdminClient() as any).from("email_log");
}

/**
 * Atomically reserve the send slot for (booking, kind, role) — the concurrency
 * guard that makes sending (not just the ledger) idempotent. Returns true only
 * to the caller that won the reservation; that caller then sends and finalizes.
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
      { onConflict: "booking_id,event_kind,recipient_role", ignoreDuplicates: true },
    )
    .select("id");
  if (insErr) throw insErr;
  if (inserted && inserted.length > 0) return true;

  // A row already exists — claim it only if it's a retryable prior attempt.
  const { data: claimed, error: updErr } = await table()
    .update({ status: "pending", recipient_email: email, resend_id: null })
    .eq("booking_id", bookingId)
    .eq("event_kind", eventKind)
    .eq("recipient_role", role)
    .in("status", ["failed", "skipped"])
    .select("id");
  if (updErr) throw updErr;
  return !!(claimed && claimed.length > 0);
}

/** Finalize a reserved slot with its terminal status + Resend id. */
export async function finalizeComms(
  bookingId: string,
  eventKind: string,
  role: string,
  outcome: { resendId: string | null; status: CommsStatus },
): Promise<void> {
  const { error } = await table()
    .update({ status: outcome.status, resend_id: outcome.resendId })
    .eq("booking_id", bookingId)
    .eq("event_kind", eventKind)
    .eq("recipient_role", role);
  if (error) throw error;
}
