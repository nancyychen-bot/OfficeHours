import { describe, it, expect } from "vitest";
import { missingRows, findOrphans } from "../lib/backup/restore";

describe("missingRows (merge-only restore)", () => {
  const snapshot = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("returns only rows whose pk isn't already present", () => {
    const existing = new Set(["b"]); // a and c were deleted since the snapshot
    expect(missingRows(snapshot, existing, "id")).toEqual([{ id: "a" }, { id: "c" }]);
  });

  it("adds nothing when everything already exists (never overwrites)", () => {
    expect(missingRows(snapshot, new Set(["a", "b", "c"]), "id")).toEqual([]);
  });

  it("ignores rows created AFTER the snapshot (they simply aren't in it)", () => {
    // 'd' exists now but isn't in the snapshot → merge leaves it alone (not returned).
    const existing = new Set(["a", "b", "c", "d"]);
    expect(missingRows(snapshot, existing, "id")).toEqual([]);
  });

  it("supports a non-id primary key (feedback_mirror)", () => {
    const rows = [{ ambassador_page_id: "p1" }, { ambassador_page_id: "p2" }];
    expect(missingRows(rows, new Set(["p1"]), "ambassador_page_id")).toEqual([{ ambassador_page_id: "p2" }]);
  });
});

describe("findOrphans", () => {
  it("returns Notion ids not referenced by any booking", () => {
    expect(findOrphans(["x", "y", "z"], new Set(["y"]))).toEqual(["x", "z"]);
  });
  it("returns none when every card is referenced", () => {
    expect(findOrphans(["x", "y"], new Set(["x", "y", "extra"]))).toEqual([]);
  });
});
