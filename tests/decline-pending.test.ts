import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Booking } from "../lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ id: "b1", luma_status: "pending", status: "unassigned", ...over } as Booking);

// Isolate the best-effort loop: stub the modules decline-pending imports so the
// only real logic exercised is declinePendingForEvent's per-booking try/catch.
const listBookingsForEvent = vi.fn<(...a: any[]) => Promise<Booking[]>>();
const applyLumaStatus = vi.fn<(b: Booking, ...a: any[]) => Promise<void>>();
const logSync = vi.fn(async () => {});

vi.mock("@/lib/db/bookings", () => ({
  listBookingsForEvent: (...a: any[]) => (listBookingsForEvent as any)(...a),
  setLumaStatus: vi.fn(),
  resetAssignment: vi.fn(),
}));
vi.mock("@/lib/db/events", () => ({ listEventsByDate: vi.fn(), getEventById: vi.fn() }));
vi.mock("@/lib/email/comms", () => ({ sendBookingComms: vi.fn() }));
vi.mock("@/lib/notion/push", () => ({ pushBookingToWorkspaces: vi.fn() }));
vi.mock("@/lib/luma/client", () => ({ updateGuestStatus: vi.fn() }));
vi.mock("@/lib/sync/approval", () => ({
  applyLumaStatus: (...a: any[]) => (applyLumaStatus as any)(...a),
}));
vi.mock("@/lib/sync/log", () => ({ logSync: (...a: any[]) => (logSync as any)(...a) }));

// Import after vi.mock so the stubbed deps are wired in.
import { selectDeclinablePendings, declinePendingForEvent } from "../lib/events/decline-pending";

describe("declinePendingForEvent (best-effort loop)", () => {
  beforeEach(() => {
    listBookingsForEvent.mockReset();
    applyLumaStatus.mockReset();
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
