import { describe, it, expect } from "vitest";
import { issueBookingToken, verifyBookingToken } from "@/lib/auth/booking-token";

const SECRET = "test-secret";
const NOW = 1_760_000_000_000; // fixed ms

describe("booking-token", () => {
  it("round-trips a booking id", async () => {
    const tok = await issueBookingToken("b-123", SECRET, NOW);
    expect(await verifyBookingToken(tok, SECRET, NOW)).toBe("b-123");
  });

  it("rejects a tampered token", async () => {
    const tok = await issueBookingToken("b-123", SECRET, NOW);
    expect(await verifyBookingToken(tok + "x", SECRET, NOW)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const tok = await issueBookingToken("b-123", SECRET, NOW);
    expect(await verifyBookingToken(tok, "other", NOW)).toBeNull();
  });

  it("rejects an expired token (>14 days old)", async () => {
    const tok = await issueBookingToken("b-123", SECRET, NOW);
    const later = NOW + 15 * 24 * 60 * 60 * 1000;
    expect(await verifyBookingToken(tok, SECRET, later)).toBeNull();
  });

  it("rejects a non-booking payload", async () => {
    const { signToken } = await import("@/lib/auth/token");
    const bad = await signToken(`form.${NOW}`, SECRET);
    expect(await verifyBookingToken(bad, SECRET, NOW)).toBeNull();
  });
});
