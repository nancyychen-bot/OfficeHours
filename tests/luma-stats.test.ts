import { describe, it, expect } from "vitest";
import { selectStatsSyncBatch, LUMA_STATS_MAX_PER_RUN } from "@/lib/events/luma-stats";

type E = { status: string | null; luma_event_id: string | null; luma_synced_at: string | null };
const ev = (id: string, synced: string | null, status = "active"): E => ({
  status,
  luma_event_id: id,
  luma_synced_at: synced,
});

describe("selectStatsSyncBatch", () => {
  it("excludes cancelled events and those without a luma_event_id", () => {
    const got = selectStatsSyncBatch(
      [ev("evt-1", null), ev("evt-2", null, "cancelled"), { ...ev("x", null), luma_event_id: null }],
      10,
    );
    expect(got.map((e) => e.luma_event_id)).toEqual(["evt-1"]);
  });

  it("syncs never-synced events (null luma_synced_at) first", () => {
    const got = selectStatsSyncBatch([ev("evt-fresh", "2026-10-14T00:00:00Z"), ev("evt-new", null)], 10);
    expect(got.map((e) => e.luma_event_id)).toEqual(["evt-new", "evt-fresh"]);
  });

  it("orders synced events stalest-first", () => {
    const got = selectStatsSyncBatch(
      [ev("evt-recent", "2026-10-14T00:00:00Z"), ev("evt-old", "2026-10-10T00:00:00Z")],
      10,
    );
    expect(got.map((e) => e.luma_event_id)).toEqual(["evt-old", "evt-recent"]);
  });

  it("caps the batch at max so one run never enumerates every event", () => {
    const many = Array.from({ length: 50 }, (_, i) => ev(`evt-${i}`, null));
    expect(selectStatsSyncBatch(many, 20)).toHaveLength(20);
  });

  it("defaults to a sane per-run cap", () => {
    expect(LUMA_STATS_MAX_PER_RUN).toBeGreaterThan(0);
    expect(LUMA_STATS_MAX_PER_RUN).toBeLessThanOrEqual(50);
  });
});
