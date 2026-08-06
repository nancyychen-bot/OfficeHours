import { describe, it, expect } from "vitest";
import { renderComms, guestDetailsLines, inviteDescription, type CommsFields } from "@/lib/email/templates";

function fields(p: Partial<CommsFields> = {}): CommsFields {
  return {
    bookingId: "b1", guestName: "Ada Lovelace", guestEmail: "ada@x.com",
    company: "Analytical", role: "Engineer", challenge: "Scaling", guestPhone: null,
    slotName: "2:00–2:30 PM", slotStartsAt: "2026-08-26T21:00:00Z", slotEndsAt: "2026-08-26T21:30:00Z",
    eventName: "Notion Build Bar (SF)", eventDate: "2026-08-26", location: "San Francisco", address: null,
    helperName: "Grace Hopper", helperEmail: "grace@x.com", status: "assigned", slotId: null, ...p,
  };
}

describe("inviteDescription", () => {
  it("is a clean confirmation (slot, address, expert, arrival nudge) — not the details dump", () => {
    const d = inviteDescription(fields({ address: "2300 Harrison St, San Francisco, CA" }));
    expect(d).toContain("confirmed");
    expect(d).toContain("2:00–2:30 PM");
    expect(d).toContain("2300 Harrison St, San Francisco, CA");
    expect(d).toContain("Grace Hopper");
    expect(d).toContain("arrive 5 minutes");
    expect(d).not.toContain("Guest Email:"); // no internal dump
    expect(d).not.toContain("Challenge:");
  });
  it("falls back to the city when there's no street address", () => {
    expect(inviteDescription(fields({ address: null }))).toContain("San Francisco");
  });
});

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
    expect(r.subject).toContain("Invitation");
    expect(r.text).toContain("Hi Grace,");
    expect(r.text).toContain("claimed a 1:1 at Notion Build Bar");
    expect(r.text).toContain("calendar invite (.ics) is attached");
    expect(r.text).toContain("The Notion Community Team");
  });
  it("assigned→guest confirms with the helper name", () => {
    const r = renderComms("assigned", "guest", fields())!;
    expect(r.subject).toContain("Invitation");
    expect(r.subject).toContain("Aug 26"); // eventDate 2026-08-26 formatted
    expect(r.text).toContain("Hi Ada,");
    expect(r.text).toContain("Grace Hopper will be your Notion expert");
    expect(r.text).toContain("The Notion Community Team");
  });
  it("assigned→guest shows the specific address when present (not just the city)", () => {
    const withAddr = renderComms("assigned", "guest", fields({ address: "2300 Harrison St, San Francisco, CA" }))!;
    expect(withAddr.text).toContain("2300 Harrison St, San Francisco, CA");
    const noAddr = renderComms("assigned", "guest", fields({ address: null }))!;
    expect(noAddr.text).toContain("San Francisco"); // falls back to city
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
  it("expert_unavailable → helper only (guest handled in the backend)", () => {
    expect(renderComms("expert_unavailable", "guest", fields())).toBeNull();
    const h = renderComms("expert_unavailable", "helper", fields())!;
    expect(h.text).toContain("back in the queue");
    expect(h.text).toContain("calendar hold has been removed");
  });
  it("rematch_pending → guest gets the day-before apology + cowork offer", () => {
    const g = renderComms("rematch_pending", "guest", fields())!;
    expect(g.text).toContain("no longer able to help");
    expect(g.text).toContain("cowork");
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
  it("waitlisted → guest gets the waitlist note, helper gets slot-freed", () => {
    const g = renderComms("waitlisted", "guest", fields())!;
    expect(g.text).toContain("waitlist");
    expect(g.text).toContain("The Notion Community Team");
    const h = renderComms("waitlisted", "helper", fields())!;
    expect(h.text).toContain("waitlist");
    expect(h.subject.toLowerCase()).toContain("freed");
  });
  it("event_cancelled → guest and helper both told the event is off", () => {
    const g = renderComms("event_cancelled", "guest", fields())!;
    expect(g.subject.toLowerCase()).toContain("cancelled");
    expect(g.text).toContain("has been cancelled");
    const h = renderComms("event_cancelled", "helper", fields())!;
    expect(h.text).toContain("cancelled");
  });
});
