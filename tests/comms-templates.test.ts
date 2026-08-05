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
    expect(r.subject).toContain("Ada Lovelace");
    expect(r.text).toContain("Hi Grace,");
    expect(r.text).toContain("claimed a 1:1 at Notion Build Bar");
    expect(r.text).toContain("calendar hold is attached");
    expect(r.text).toContain("The Notion Community Team");
  });
  it("assigned→guest confirms with the helper name", () => {
    const r = renderComms("assigned", "guest", fields())!;
    expect(r.subject).toContain("booked for Notion Build Bar");
    expect(r.text).toContain("Hi Ada,");
    expect(r.text).toContain("Grace Hopper will be your Notion expert");
    expect(r.text).toContain("The Notion Community Team");
  });
  it("checked_in→helper", () => {
    const r = renderComms("checked_in", "helper", fields())!;
    expect(r.subject).toContain("checked in");
    expect(r.subject).toContain("Ada Lovelace");
    expect(r.text).toContain("is checked in");
  });
  it("no_show→helper", () => {
    const r = renderComms("no_show", "helper", fields())!;
    expect(r.subject).toBe("No-show: Ada Lovelace");
    expect(r.text).toContain("no-show");
  });
  it("checked_in→guest gets a welcome confirmation", () => {
    const r = renderComms("checked_in", "guest", fields())!;
    expect(r.subject.toLowerCase()).toContain("checked in");
    expect(r.text).toContain("Hi Ada,");
    expect(r.text).toContain("welcome to Notion Build Bar");
  });
  it("guest still gets nothing for no_show", () => {
    expect(renderComms("no_show", "guest", fields())).toBeNull();
  });
  it("cancelled → guest and helper", () => {
    const g = renderComms("cancelled", "guest", fields())!;
    expect(g.subject.toLowerCase()).toContain("cancelled");
    expect(g.text).toContain("Hi Ada,");
    const h = renderComms("cancelled", "helper", fields())!;
    expect(h.subject.toLowerCase()).toContain("freed");
  });
  it("expert_unavailable → guest (replacement coming) and helper (hold removed)", () => {
    const g = renderComms("expert_unavailable", "guest", fields())!;
    expect(g.text).toContain("no longer available");
    const h = renderComms("expert_unavailable", "helper", fields())!;
    expect(h.text).toContain("back in the queue");
    expect(h.text).toContain("calendar hold has been removed");
  });
  it("declined → guest gets the at-capacity note with the calendar link", () => {
    const g = renderComms("declined", "guest", fields())!;
    expect(g.text).toContain("Hi Ada,");
    expect(g.text).toContain("reached capacity");
    expect(g.text).toContain("https://luma.com/calendar/cal-ZDQrtBgbNzSJZkh");
    expect(g.text).toContain("The Notion Community Team");
  });
  it("declined → helper gets a slot-freed note", () => {
    const h = renderComms("declined", "helper", fields())!;
    expect(h.subject.toLowerCase()).toContain("freed");
    expect(h.text).toContain("released");
  });
});
