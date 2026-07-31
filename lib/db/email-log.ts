import { getAdminClient } from "../supabase/admin";

export type CommsStatus = "sent" | "failed" | "skipped";

// email_log isn't in the generated Database types yet; access it loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getAdminClient() as any).from("email_log");
}

/** True if a comms row already exists for this (booking, kind, role). */
export async function hasSentComms(
  bookingId: string,
  eventKind: string,
  role: string,
): Promise<boolean> {
  const { data, error } = await table()
    .select("id")
    .eq("booking_id", bookingId)
    .eq("event_kind", eventKind)
    .eq("recipient_role", role)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return !!data;
}

/** Record an attempt. Swallows unique-violation (23505) as already-recorded. */
export async function recordComms(row: {
  bookingId: string;
  eventKind: string;
  role: string;
  email: string;
  resendId: string | null;
  status: CommsStatus;
}): Promise<void> {
  const { error } = await table().insert({
    booking_id: row.bookingId,
    event_kind: row.eventKind,
    recipient_role: row.role,
    recipient_email: row.email,
    resend_id: row.resendId,
    status: row.status,
  });
  if (error && error.code !== "23505") throw error;
}
