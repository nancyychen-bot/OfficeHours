import { describe, it, expect } from "vitest";
import { hashSyncedFields, isEcho } from "@/lib/sync/hash";
import type { SyncedFields } from "@/lib/sync/types";

const base: SyncedFields = {
  status: "unassigned",
  luma_status: "pending",
  booked_by_display_name: null,
  booked_by_type: null,
};

describe("hashSyncedFields", () => {
  it("changes when luma_status changes", () => {
    const a = hashSyncedFields(base);
    const b = hashSyncedFields({ ...base, luma_status: "approved" });
    expect(a).not.toBe(b);
  });
  it("isEcho true only for the identical state", () => {
    const h = hashSyncedFields(base);
    expect(isEcho(base, h)).toBe(true);
    expect(isEcho({ ...base, luma_status: "approved" }, h)).toBe(false);
  });
});
