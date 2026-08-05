import { describe, it, expect } from "vitest";
import { hashSyncedFields, isEcho } from "@/lib/sync/hash";
import type { SyncedFields } from "@/lib/sync/types";

const assigned: SyncedFields = {
  status: "assigned",
  luma_status: "approved",
  booked_by_display_name: "Jane Doe",
  booked_by_type: "employee",
};

describe("hashSyncedFields", () => {
  it("is deterministic for equal states", () => {
    expect(hashSyncedFields(assigned)).toBe(hashSyncedFields({ ...assigned }));
  });

  it("differs when a synced field changes", () => {
    expect(hashSyncedFields(assigned)).not.toBe(
      hashSyncedFields({ ...assigned, status: "checked_in" }),
    );
    expect(hashSyncedFields(assigned)).not.toBe(
      hashSyncedFields({ ...assigned, booked_by_display_name: "Someone Else" }),
    );
    expect(hashSyncedFields(assigned)).not.toBe(
      hashSyncedFields({ ...assigned, luma_status: "waitlist" }),
    );
  });

  it("treats undefined and null nullable fields as equal", () => {
    const withNull: SyncedFields = { status: "unassigned", luma_status: "pending", booked_by_display_name: null, booked_by_type: null };
    const withUndef = { status: "unassigned", luma_status: "pending", booked_by_display_name: undefined, booked_by_type: undefined } as unknown as SyncedFields;
    expect(hashSyncedFields(withNull)).toBe(hashSyncedFields(withUndef));
  });
});

describe("isEcho (loop prevention, PRD §7.3)", () => {
  it("recognizes an echo of the hub's own last write", () => {
    const stored = hashSyncedFields(assigned);
    expect(isEcho(assigned, stored)).toBe(true);
  });

  it("treats a real human change as NOT an echo", () => {
    const stored = hashSyncedFields(assigned);
    const humanChange: SyncedFields = { ...assigned, status: "checked_in" };
    expect(isEcho(humanChange, stored)).toBe(false);
  });

  it("is never an echo when nothing has been synced yet", () => {
    expect(isEcho(assigned, null)).toBe(false);
  });
});
