import { describe, it, expect } from "vitest";
import { approvalStatusToLumaStatus } from "@/lib/luma/approval";

describe("approvalStatusToLumaStatus", () => {
  it("maps known statuses", () => {
    expect(approvalStatusToLumaStatus("approved")).toBe("approved");
    expect(approvalStatusToLumaStatus("declined")).toBe("declined");
    expect(approvalStatusToLumaStatus("waitlist")).toBe("waitlist");
  });
  it("maps Luma 'invited' to the invited status (not pending)", () => {
    expect(approvalStatusToLumaStatus("invited")).toBe("invited");
  });
  it("treats pending/unknown/null as pending", () => {
    for (const v of ["pending_approval", "pending", "", null, undefined, "weird"]) {
      expect(approvalStatusToLumaStatus(v as string | null)).toBe("pending");
    }
  });
});
