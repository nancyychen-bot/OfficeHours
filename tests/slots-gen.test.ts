import { describe, it, expect } from "vitest";
import { generateSlotsFromOptions } from "@/lib/events/slots-gen";

describe("generateSlotsFromOptions", () => {
  it("assigns sequential times to labels in order", () => {
    const slots = generateSlotsFromOptions(
      ["2:00-2:30 PM", "2:30-3:00 PM"],
      "2026-08-26T21:00:00.000Z",
      30,
    );
    expect(slots).toEqual([
      { name: "2:00-2:30 PM", starts_at: "2026-08-26T21:00:00.000Z", ends_at: "2026-08-26T21:30:00.000Z" },
      { name: "2:30-3:00 PM", starts_at: "2026-08-26T21:30:00.000Z", ends_at: "2026-08-26T22:00:00.000Z" },
    ]);
  });

  it("keeps localized labels verbatim", () => {
    const slots = generateSlotsFromOptions(["午後2時〜2時30分"], "2026-08-26T05:00:00.000Z", 30);
    expect(slots[0].name).toBe("午後2時〜2時30分");
    expect(slots[0].ends_at).toBe("2026-08-26T05:30:00.000Z");
  });

  it("honors a custom slot length", () => {
    const slots = generateSlotsFromOptions(["A", "B"], "2026-08-26T21:00:00.000Z", 20);
    expect(slots[1].starts_at).toBe("2026-08-26T21:20:00.000Z");
  });

  it("returns [] for no labels", () => {
    expect(generateSlotsFromOptions([], "2026-08-26T21:00:00.000Z", 30)).toEqual([]);
  });
});
