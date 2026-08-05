import { describe, it, expect } from "vitest";
import { renderComms, guestDetailsLines, type CommsFields } from "@/lib/email/templates";

function fields(p: Partial<CommsFields> = {}): CommsFields {
  return {
    bookingId: "b1", guestName: "Ada Lovelace", guestEmail: "ada@x.com",
    company: "Analytical", role: "Engineer", challenge: "Scaling", guestPhone: null,
    slotName: "2:00–2:30 PM", slotStartsAt: "2026-08-26T21:00:00Z", slotEndsAt: "2026-08-26T21:30:00Z",
    eventName: "Notion Build Bar (SF)", eventDate: "2026-08-26", location: "San Francisco",
    helperName: "Grace Hopper", helperEmail: "grace@x.com", status: "assigned", ...p,
  };
}

describe("guestDetailsLines", () => {
  it("includes core fields and omits absent optionals", () => {
    const lines = guestDetailsLines(fields({ guestPhone: null, company: null }));
    expect(lines).toContain("Guest Name: Ada Lovelace");
    expect(lines).toContain("Time Slot: 2:00–2:30 PM");
    expect(lines.some((l) => l.startsWith("Company:"))).toBe(false);
    expect(lines.some((l) => l.startsWith("Guest phone:"))).toBe(false);
  });
  it("includes optionals when present", () => {
    const lines = guestDetailsLines(fields({ company: "Acme", guestPhone: "+1" }));
    expect(lines).toContain("Company: Acme");
    expect(lines).toContain("Guest phone: +1");
  });
});

describe("renderComms", () => {
  it("assigned→helper uses the confirmation subject/body", () => {
    const r = renderComms("assigned", "helper", fields())!;
    expect(r.subject).toBe("Notion Build Bar booking confirmed — Ada Lovelace");
    expect(r.text).toContain("Hi Grace Hopper,");
    expect(r.text).toContain("Your Notion Build Bar booking has been confirmed.");
    expect(r.text).toContain("A calendar hold has been added");
  });
  it("assigned→guest confirms with the helper name", () => {
    const r = renderComms("assigned", "guest", fields())!;
    expect(r.subject).toContain("Your Notion Build Bar slot is confirmed");
    expect(r.text).toContain("Hi Ada Lovelace,");
    expect(r.text).toContain("confirmed with Grace Hopper");
  });
  it("checked_in→helper", () => {
    const r = renderComms("checked_in", "helper", fields())!;
    expect(r.subject).toBe("Guest checked in: Ada Lovelace");
    expect(r.text).toContain("has been marked as checked in");
  });
  it("no_show→helper", () => {
    const r = renderComms("no_show", "helper", fields())!;
    expect(r.subject).toBe("No-show: Ada Lovelace");
    expect(r.text).toContain("marked as a no-show");
  });
  it("checked_in→guest gets a welcome confirmation", () => {
    const r = renderComms("checked_in", "guest", fields())!;
    expect(r.subject.toLowerCase()).toContain("checked in");
    expect(r.text).toContain("Hi Ada Lovelace,");
    expect(r.text).toContain("You're checked in");
  });
  it("guest still gets nothing for no_show", () => {
    expect(renderComms("no_show", "guest", fields())).toBeNull();
  });
  it("cancelled → guest and helper", () => {
    const g = renderComms("cancelled", "guest", fields())!;
    expect(g.subject.toLowerCase()).toContain("cancelled");
    expect(g.text).toContain("Hi Ada Lovelace,");
    const h = renderComms("cancelled", "helper", fields())!;
    expect(h.subject.toLowerCase()).toContain("released");
  });
  it("expert_unavailable → guest only", () => {
    const g = renderComms("expert_unavailable", "guest", fields())!;
    expect(g.text).toContain("expert is unavailable");
    expect(renderComms("expert_unavailable", "helper", fields())).toBeNull();
  });
});
