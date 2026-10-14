import { signToken, verifyToken } from "./token";

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** A per-booking magic-link token for the invited-guest completion form. Carries
 * the booking id + issue time; verified by signature and a 14-day window. */
export async function issueBookingToken(bookingId: string, secret: string, nowMs: number): Promise<string> {
  return signToken(`booking.${bookingId}.${nowMs}`, secret);
}

export async function verifyBookingToken(token: string, secret: string, nowMs: number): Promise<string | null> {
  const payload = await verifyToken(token, secret);
  if (!payload || !payload.startsWith("booking.")) return null;
  const rest = payload.slice("booking.".length);
  const lastDot = rest.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const bookingId = rest.slice(0, lastDot);
  const issued = Number(rest.slice(lastDot + 1));
  if (!bookingId || !Number.isFinite(issued)) return null;
  if (nowMs < issued || nowMs - issued > MAX_AGE_MS) return null;
  return bookingId;
}
