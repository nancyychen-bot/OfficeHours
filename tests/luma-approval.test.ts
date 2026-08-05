import { describe, it, expect } from "vitest";
import { approvalStatusToLumaStatus } from "@/lib/luma/approval";

describe("approvalStatusToLumaStatus", () => {
  it("maps known statuses", () => {
    expect(approvalStatusToLumaStatus("approved")).toBe("approved");
    expect(approvalStatusToLumaStatus("declined")).toBe("declined");
    expect(approvalStatusToLumaStatus("waitlist")).toBe("waitlist");
  });
  it("treats pending/invited/unknown/null as pending", () => {
    for (const v of ["pending_approval", "pending", "invited", "", null, undefined, "weird"]) {
      expect(approvalStatusToLumaStatus(v as string | null)).toBe("pending");
    }
  });
});
