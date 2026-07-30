import { describe, it, expect } from "vitest";
import { parseLumaEventId, extractSlotOptions } from "@/lib/luma/client";
import type { LumaRegistrationQuestion } from "@/lib/luma/types";

describe("parseLumaEventId", () => {
  it("returns an evt- id unchanged", () => {
    expect(parseLumaEventId("evt-PHUN4WtUCSD9dgi")).toBe("evt-PHUN4WtUCSD9dgi");
  });
  it("extracts an evt- id embedded in a URL/string", () => {
    expect(parseLumaEventId("https://lu.ma/manage/evt-PHUN4WtUCSD9dgi/x")).toBe("evt-PHUN4WtUCSD9dgi");
  });
  it("throws when no evt- id is present", () => {
    expect(() => parseLumaEventId("https://lu.ma/some-slug")).toThrow();
  });
});

describe("extractSlotOptions", () => {
  const slotQ: LumaRegistrationQuestion = {
    id: "q3", label: "Requested time slot for 1:1 help",
    options: ["2:00-2:30 PM", "2:30-3:00 PM", "3:00-3:30 PM"],
  };
  const textQ: LumaRegistrationQuestion = { id: "q1", label: "What company do you work for?" };

  it("returns the ordered labels of the only question with options", () => {
    expect(extractSlotOptions([textQ, slotQ])).toEqual([
      "2:00-2:30 PM", "2:30-3:00 PM", "3:00-3:30 PM",
    ]);
  });
  it("prefers a slot/time-labelled question when several have options", () => {
    const other: LumaRegistrationQuestion = { id: "q9", label: "Dietary preference", options: ["Veg", "Non-veg"] };
    expect(extractSlotOptions([other, slotQ])).toEqual([
      "2:00-2:30 PM", "2:30-3:00 PM", "3:00-3:30 PM",
    ]);
  });
  it("normalizes option objects to their label/name", () => {
    const objQ: LumaRegistrationQuestion = { id: "q3", label: "time slot", options: [{ label: "9:00 AM" }, { name: "9:30 AM" }] };
    expect(extractSlotOptions([objQ])).toEqual(["9:00 AM", "9:30 AM"]);
  });
  it("returns [] when no question has options", () => {
    expect(extractSlotOptions([textQ])).toEqual([]);
  });
});
