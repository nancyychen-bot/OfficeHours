import { describe, it, expect } from "vitest";
import { mergeLocationOptions } from "@/lib/notion/location-options";

describe("mergeLocationOptions", () => {
  it("appends the city when it is not present", () => {
    const existing = [{ id: "1", name: "SF", color: "blue" }];
    expect(mergeLocationOptions(existing, "London")).toEqual([
      { id: "1", name: "SF", color: "blue" },
      { name: "London" },
    ]);
  });

  it("returns null when the city already exists (exact match)", () => {
    const existing = [{ id: "1", name: "SF" }, { id: "2", name: "London" }];
    expect(mergeLocationOptions(existing, "London")).toBeNull();
  });

  it("trims the incoming city before comparing and appending", () => {
    const existing = [{ id: "1", name: "London" }];
    expect(mergeLocationOptions(existing, "  London  ")).toBeNull();
    expect(mergeLocationOptions([], "  Paris  ")).toEqual([{ name: "Paris" }]);
  });

  it("preserves existing options (ids/colors) untouched", () => {
    const existing = [
      { id: "1", name: "SF", color: "blue" },
      { id: "2", name: "NYC", color: "red" },
    ];
    const merged = mergeLocationOptions(existing, "Tokyo");
    expect(merged).toEqual([...existing, { name: "Tokyo" }]);
  });

  it("is case-sensitive: a different case is treated as a new option", () => {
    const existing = [{ id: "1", name: "london" }];
    expect(mergeLocationOptions(existing, "London")).toEqual([
      { id: "1", name: "london" },
      { name: "London" },
    ]);
  });
});
