import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression: the day-of agenda cron self-heals hourly, so the additive Slack DM
// must be gated by the same email_log reserve as the email — otherwise it re-posts
// every hour (9am, 10am, …). This locks the DM to once per expert per event.

const reserveCommsSlot = vi.fn<(...a: any[]) => Promise<boolean>>();
const dmByEmail = vi.fn(async () => {});
const finalizeComms = vi.fn(async () => {});
const sendEmail = vi.fn(async () => ({ id: "e1" }));

const bookingRow = {
  id: "b1", guest_name: "Ada", challenge: "Roadmaps", role: "PM", company: "Acme",
  slot_name: "2:00 PM", slot_starts_at: "2026-08-26T18:00:00Z",
  booked_by_email: "grace@x.com", booked_by_display_name: "Grace Hopper",
  status: "assigned", event_name: "NYC", event_date: "2026-08-26",
};

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [bookingRow] }) }) }),
  }),
}));
vi.mock("@/lib/db/email-log", () => ({
  reserveCommsSlot: (...a: any[]) => (reserveCommsSlot as any)(...a),
  finalizeComms: (...a: any[]) => (finalizeComms as any)(...a),
}));
vi.mock("@/lib/slack/api", () => ({ dmByEmail: (...a: any[]) => (dmByEmail as any)(...a) }));
vi.mock("@/lib/slack/blocks", () => ({ buildAgendaBlocks: () => [] }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: (...a: any[]) => (sendEmail as any)(...a) }));
vi.mock("@/lib/db/email-overrides", () => ({ getLiveOverrideMap: vi.fn(async () => new Map()) }));
vi.mock("@/lib/env", () => ({ env: { comms: { enabled: () => true } } }));
vi.mock("@/lib/sync/log", () => ({ logSync: vi.fn(async () => {}) }));

import { sendAgendasForEvent } from "../lib/events/agenda";

describe("agenda Slack DM dedup", () => {
  beforeEach(() => {
    reserveCommsSlot.mockReset();
    dmByEmail.mockReset();
  });

  it("DMs each expert once even when the hourly cron re-runs", async () => {
    // 9am reserves (true), 10am already reserved (false).
    reserveCommsSlot.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await sendAgendasForEvent("ev1"); // posts DM + email
    await sendAgendasForEvent("ev1"); // reserve returns false → skip entirely

    expect(dmByEmail).toHaveBeenCalledTimes(1);
  });

  it("does not DM when the slot is already reserved", async () => {
    reserveCommsSlot.mockResolvedValue(false);
    await sendAgendasForEvent("ev1");
    expect(dmByEmail).not.toHaveBeenCalled();
  });
});
