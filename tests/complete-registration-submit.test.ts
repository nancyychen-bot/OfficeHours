import { describe, it, expect } from "vitest";
import { buildGuestData } from "@/app/api/complete-registration/submit/build";
import { normalizeGuest } from "@/lib/luma/parse";

describe("buildGuestData → normalizeGuest", () => {
  it("maps a completed form onto the hub fields + slot", () => {
    const data = buildGuestData({
      lumaGuestId: "gst-9", guestEmail: "g@x.com", lumaEventId: "evt-9",
      answers: [
        { label: "What do you need help with?", kind: "text", value: "Automations" },
        { label: "Requested time slot", kind: "slot", value: "2:00-2:30 PM" },
        { label: "Experience level", kind: "select", value: "Beginner" },
      ],
    });
    const norm = normalizeGuest(data);
    expect(norm.challenge).toBe("Automations");
    expect(norm.requestedSlot).toBe("2:00-2:30 PM");
    expect(norm.experienceLevel).toBe("Beginner");
    expect(norm.lumaGuestId).toBe("gst-9");
    expect(norm.lumaEventId).toBe("evt-9");
  });

  it("preserves the invited guest's name + phone (not clobbered to email)", () => {
    const data = buildGuestData({
      lumaGuestId: "gst-11", guestEmail: "sam@x.com", lumaEventId: "evt-11",
      guestName: "Sam Rivera", guestPhone: "+1 555 0100",
      answers: [{ label: "What would you need help with building?", kind: "text", value: "Dashboards" }],
    });
    const norm = normalizeGuest(data);
    expect(norm.guestName).toBe("Sam Rivera");
    expect(norm.guestPhone).toBe("+1 555 0100");
  });

  it("drops blank answers so empty fields stay unmapped", () => {
    const data = buildGuestData({
      lumaGuestId: "gst-10", guestEmail: "g@x.com", lumaEventId: "evt-10",
      answers: [
        { label: "What do you need help with?", kind: "text", value: "  " },
        { label: "Experience level", kind: "select", value: "" },
      ],
    });
    expect(data.registration_answers).toEqual([]);
    const norm = normalizeGuest(data);
    expect(norm.challenge).toBeNull();
    expect(norm.experienceLevel).toBeNull();
  });
});
