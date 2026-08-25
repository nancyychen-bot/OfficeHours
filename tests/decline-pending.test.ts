import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Booking } from "../lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ id: "b1", luma_status: "pending", status: "unassigned", ...over } as Booking);

// Isolate the best-effort loop: stub the modules decline-pending imports so the
// only real logic exercised is declinePendingForEvent's per-booking try/catch.
const listBookingsForEvent = vi.fn<(...a: any[]) => Promise<Booking[]>>();
const applyLumaStatus = vi.fn<(b: Booking, ...a: any[]) => Promise<void>>();
const listEventsInDateRange = vi.fn<(...a: any[]) => Promise<any[]>>();
const logSync = vi.fn(async () => {});

vi.mock("@/lib/db/bookings", () => ({
  listBookingsForEvent: (...a: any[]) => (listBookingsForEvent as any)(...a),
  setLumaStatus: vi.fn(),
  resetAssignment: vi.fn(),
}));
vi.mock("@/lib/db/events", () => ({
  listEventsInDateRange: (...a: any[]) => (listEventsInDateRange as any)(...a),
  getEventById: vi.fn(),
}));
vi.mock("@/lib/email/comms", () => ({ sendBookingComms: vi.fn() }));
vi.mock("@/lib/notion/push", () => ({ pushBookingToWorkspaces: vi.fn() }));
vi.mock("@/lib/luma/client", () => ({ updateGuestStatus: vi.fn() }));
vi.mock("@/lib/sync/approval", () => ({
  applyLumaStatus: (...a: any[]) => (applyLumaStatus as any)(...a),
}));
vi.mock("@/lib/sync/log", () => ({ logSync: (...a: any[]) => (logSync as any)(...a) }));

// Import after vi.mock so the stubbed deps are wired in.
import {
  selectDeclinablePendings,
  declinePendingForEvent,
  dispatchDeclinePendingForTomorrow,
} from "../lib/events/decline-pending";

describe("declinePendingForEvent (best-effort loop)", () => {
  beforeEach(() => {
    listBookingsForEvent.mockReset();
    applyLumaStatus.mockReset();
    listEventsInDateRange.mockReset();
    logSync.mockReset();
  });

  it("keeps declining after one booking throws and returns the success count", async () => {
    listBookingsForEvent.mockResolvedValue([
      bk({ id: "p1" }),
      bk({ id: "p2" }),
      bk({ id: "p3" }),
    ]);
    applyLumaStatus.mockImplementation(async (b) => {
      if (b.id === "p2") throw new Error("boom");
    });

    const declined = await declinePendingForEvent("ev1");

    expect(declined).toBe(2); // p1 + p3 succeeded, p2 threw
    expect(applyLumaStatus).toHaveBeenCalledTimes(3); // the throw did not abort the loop
  });

  it("declines every pending in a large list (bounded concurrency drains all)", async () => {
    const ids = Array.from({ length: 23 }, (_, i) => `p${i}`);
    listBookingsForEvent.mockResolvedValue(ids.map((id) => bk({ id })));
    applyLumaStatus.mockResolvedValue(undefined);

    const declined = await declinePendingForEvent("ev1");

    expect(declined).toBe(23); // none left behind
    expect(applyLumaStatus).toHaveBeenCalledTimes(23);
    const seen = applyLumaStatus.mock.calls.map((c) => c[0].id).sort();
    expect(seen).toEqual([...ids].sort());
  });
});

describe("dispatchDeclinePendingForTomorrow (timezone filter)", () => {
  beforeEach(() => {
    listBookingsForEvent.mockReset();
    applyLumaStatus.mockReset();
    listEventsInDateRange.mockReset();
    logSync.mockReset();
  });

  it("only processes events whose local clock has reached 8am at (event_date − 1)", async () => {
    // now = 13:00 UTC on 2026-08-25. Both events are on 2026-08-26, so the
    // decline rule (offsetDays −1, targetHour 8) targets 8am local on 2026-08-25.
    //  - New_York (UTC-4 DST): 09:00 local → 9 ≥ 8 → DUE
    //  - Los_Angeles (UTC-7 DST): 06:00 local → 6 < 8 → NOT yet
    const now = new Date("2026-08-25T13:00:00Z");
    listEventsInDateRange.mockResolvedValue([
      { id: "due", event_date: "2026-08-26", timezone: "America/New_York" },
      { id: "early", event_date: "2026-08-26", timezone: "America/Los_Angeles" },
    ]);
    // One still-pending booking per event, tagged with its event id so we can
    // assert which events were actually processed.
    listBookingsForEvent.mockImplementation(async (eventId: string) => [
      bk({ id: `${eventId}-p1` }),
    ]);

    const res = await dispatchDeclinePendingForTomorrow(now);

    expect(res.events).toBe(1);
    expect(res.guests).toBe(1);
    // Only the due event's booking was declined.
    const declinedIds = applyLumaStatus.mock.calls.map((c) => c[0].id);
    expect(declinedIds).toEqual(["due-p1"]);
    // The not-yet-due event was never fetched/processed.
    expect(listBookingsForEvent).toHaveBeenCalledWith("due");
    expect(listBookingsForEvent).not.toHaveBeenCalledWith("early");
  });
});

describe("selectDeclinablePendings", () => {
  it("selects only pending bookings", () => {
    const rows = [
      bk({ id: "p1", luma_status: "pending" }),
      bk({ id: "p2", luma_status: "pending", status: "no_help_needed" }),
      bk({ id: "a1", luma_status: "approved" }),
      bk({ id: "w1", luma_status: "waitlist" }),
      bk({ id: "d1", luma_status: "declined" }),
    ];
    expect(selectDeclinablePendings(rows).map((b) => b.id)).toEqual(["p1", "p2"]);
  });

  it("returns empty when nothing is pending", () => {
    expect(selectDeclinablePendings([bk({ luma_status: "approved" })])).toEqual([]);
  });

  it("includes pendings regardless of assignment status (all pendings)", () => {
    const rows = [
      bk({ id: "u1", luma_status: "pending", status: "unassigned" }),
      bk({ id: "n1", luma_status: "pending", status: "no_help_needed" }),
    ];
    expect(selectDeclinablePendings(rows).map((b) => b.id)).toEqual(["u1", "n1"]);
  });
});
