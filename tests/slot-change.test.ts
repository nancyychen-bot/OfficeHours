import { describe, it, expect } from "vitest";
import { renderComms, templateKeyFor, SAMPLE_FIELDS } from "../lib/email/templates";

describe("slot_changed emails", () => {
  it("routes guest + helper variants", () => {
    expect(templateKeyFor("slot_changed", "guest", SAMPLE_FIELDS)).toBe("slot_changed__guest");
    expect(templateKeyFor("slot_changed", "helper", SAMPLE_FIELDS)).toBe("slot_changed__helper");
  });
  it("guest email names the new slot + promises a rematch", () => {
    const r = renderComms("slot_changed", "guest", { ...SAMPLE_FIELDS, slotName: "3:00–3:30 PM" })!;
    expect(r.subject).toContain("3:00–3:30 PM");
    expect(r.text).toContain("match you with a Notion expert");
  });
  it("helper email says removed + calendar cancelled", () => {
    const r = renderComms("slot_changed", "helper", SAMPLE_FIELDS)!;
    expect(r.text).toContain("you've been removed");
    expect(r.text).toContain("cancelled");
  });
});
