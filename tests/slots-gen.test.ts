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

  it("follows the label clock times, not the fixed length (20-min blocks)", () => {
    // Sydney: 20-min labels but the default length is 30. The labels must win,
    // so the times stay 20 min apart instead of drifting.
    const slots = generateSlotsFromOptions(
      ["5:00-5:20PM", "5:20-5:40PM", "5:40-6:00PM"],
      "2026-10-22T06:00:00.000Z", // first label's start = event start
      30,
    );
    expect(slots.map((s) => s.starts_at)).toEqual([
      "2026-10-22T06:00:00.000Z",
      "2026-10-22T06:20:00.000Z",
      "2026-10-22T06:40:00.000Z",
    ]);
    expect(slots[0].ends_at).toBe("2026-10-22T06:20:00.000Z"); // 5:20 PM
  });

  it("honors gaps between non-contiguous labels", () => {
    const slots = generateSlotsFromOptions(
      ["5:00-5:20PM", "7:40-8:00PM"],
      "2026-10-22T06:00:00.000Z",
      20,
    );
    expect(slots[1].starts_at).toBe("2026-10-22T08:40:00.000Z"); // 7:40 PM = +160 min
    expect(slots[1].ends_at).toBe("2026-10-22T09:00:00.000Z"); // 8:00 PM
  });
});
