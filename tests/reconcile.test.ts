import { describe, it, expect } from "vitest";
import { reconcileSlots } from "@/lib/events/reconcile";

const desired = [
  { name: "2:00-2:30 PM", starts_at: "2026-08-26T21:00:00.000Z", ends_at: "2026-08-26T21:30:00.000Z" },
  { name: "2:30-3:00 PM", starts_at: "2026-08-26T21:30:00.000Z", ends_at: "2026-08-26T22:00:00.000Z" },
];

describe("reconcileSlots", () => {
  it("inserts all when none exist", () => {
    const r = reconcileSlots([], desired);
    expect(r.toInsert).toHaveLength(2);
    expect(r.toUpdate).toHaveLength(0);
    expect(r.toDeleteIds).toHaveLength(0);
  });

  it("updates existing by name (carrying the id) and inserts new", () => {
    const existing = [{ id: "s1", name: "2:00-2:30 PM" }];
    const r = reconcileSlots(existing, desired);
    expect(r.toUpdate).toEqual([
      { id: "s1", name: "2:00-2:30 PM", starts_at: "2026-08-26T21:00:00.000Z", ends_at: "2026-08-26T21:30:00.000Z" },
    ]);
    expect(r.toInsert.map((s) => s.name)).toEqual(["2:30-3:00 PM"]);
  });

  it("marks existing-not-desired for deletion", () => {
    const existing = [{ id: "s1", name: "2:00-2:30 PM" }, { id: "s9", name: "OLD SLOT" }];
    const r = reconcileSlots(existing, desired);
    expect(r.toDeleteIds).toEqual(["s9"]);
  });
});
