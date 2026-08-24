import { describe, it, expect } from "vitest";
import { emailKindLabel } from "../lib/email/kind-label";

describe("emailKindLabel", () => {
  it("humanizes a snake_case kind", () => {
    expect(emailKindLabel("prep_reminder")).toBe("Prep reminder");
    expect(emailKindLabel("prep_reminder_day_before")).toBe("Prep reminder day before");
    expect(emailKindLabel("guest_cancelled")).toBe("Guest cancelled");
  });
  it("handles empty/unknown gracefully", () => {
    expect(emailKindLabel("")).toBe("");
    expect(emailKindLabel("assigned")).toBe("Assigned");
  });
});
