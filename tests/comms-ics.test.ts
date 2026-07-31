import { describe, it, expect } from "vitest";
import { buildInvite, inviteAttachment, fromAddressEmail, type IcsFields } from "@/lib/email/ics";

function icsFields(p: Partial<IcsFields> = {}): IcsFields {
  return {
    bookingId: "b1", guestName: "Ada, Lovelace", guestEmail: "ada@x.com",
    helperEmail: "grace@x.com", helperName: "Grace Hopper",
    slotStartsAt: "2026-08-26T21:00:00Z", slotEndsAt: "2026-08-26T21:30:00Z",
    location: "SF HQ", descriptionText: "Guest Name: Ada\nChallenge: Scaling", ...p,
  };
}
const FROM = "hello@officehours.com";
const STAMP = "2026-07-31T00:00:00Z";

describe("fromAddressEmail", () => {
  it("extracts the address from a display-name form", () => {
    expect(fromAddressEmail("Office Hours <hello@d.com>")).toBe("hello@d.com");
    expect(fromAddressEmail("hello@d.com")).toBe("hello@d.com");
  });
});

describe("buildInvite", () => {
  it("returns a VCALENDAR with a stable UID, both attendees, and CRLF lines", () => {
    const ics = buildInvite(icsFields(), FROM, STAMP)!;
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:booking-b1@officehours");
    expect(ics).toContain("DTSTART:20260826T210000Z");
    expect(ics).toContain("DTEND:20260826T213000Z");
    expect(ics).toContain("mailto:grace@x.com");
    expect(ics).toContain("mailto:ada@x.com");
    expect(ics).toContain("\r\n");
    // commas in TEXT values are escaped
    expect(ics).toContain("SUMMARY:Office Hours — Ada\\, Lovelace");
  });
  it("defaults DTEND to start+30min when no end time", () => {
    const ics = buildInvite(icsFields({ slotEndsAt: null }), FROM, STAMP)!;
    expect(ics).toContain("DTSTART:20260826T210000Z");
    expect(ics).toContain("DTEND:20260826T213000Z");
  });
  it("returns null when the start time is missing or unparseable", () => {
    expect(buildInvite(icsFields({ slotStartsAt: null }), FROM, STAMP)).toBeNull();
    expect(buildInvite(icsFields({ slotStartsAt: "not-a-date" }), FROM, STAMP)).toBeNull();
  });
});

describe("inviteAttachment", () => {
  it("wraps ics text as an invite.ics Buffer attachment", () => {
    const a = inviteAttachment("BEGIN:VCALENDAR");
    expect(a.filename).toBe("invite.ics");
    expect(a.content.toString("utf8")).toBe("BEGIN:VCALENDAR");
  });
});
