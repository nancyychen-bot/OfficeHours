import { describe, it, expect } from "vitest";
import {
  substitute,
  templateKeyFor,
  renderComms,
  SAMPLE_FIELDS,
  type CommsFields,
  type OverrideMap,
} from "../lib/email/templates";

const f = (over: Partial<CommsFields> = {}): CommsFields => ({ ...SAMPLE_FIELDS, ...over });

describe("substitute", () => {
  it("replaces known tokens and leaves unknown ones intact", () => {
    expect(substitute("Hi {{firstName}} — {{mystery}}", { firstName: "Ada" })).toBe("Hi Ada — {{mystery}}");
  });
});

describe("templateKeyFor", () => {
  it("selects the checked-in guest variant by context", () => {
    expect(templateKeyFor("checked_in", "guest", f({ helperName: "Alex" }))).toBe("checked_in__guest__matched");
    expect(templateKeyFor("checked_in", "guest", f({ helperName: null, slotName: "2:00" }))).toBe("checked_in__guest__unmatched");
    expect(templateKeyFor("checked_in", "guest", f({ helperName: null, slotName: null }))).toBe("checked_in__guest__nohelp");
  });
  it("selects arrived-after-no-show guest variant", () => {
    expect(templateKeyFor("arrived_after_no_show", "guest", f({ helperName: "Alex" }))).toBe("arrived_after_no_show__guest__matched");
    expect(templateKeyFor("arrived_after_no_show", "guest", f({ helperName: null }))).toBe("arrived_after_no_show__guest__nohelp");
  });
  it("maps simple kind×role and returns null for undefined combos", () => {
    expect(templateKeyFor("double_booked", "helper", f())).toBe("double_booked__helper");
    expect(templateKeyFor("no_show", "guest", f())).toBeNull();
  });
});

describe("renderComms", () => {
  it("renders the built-in default when there is no override", () => {
    const r = renderComms("assigned", "guest", f({ eventDate: "2026-08-28", helperName: "Alex Rivera" }))!;
    expect(r.subject).toBe("📅 Invitation: your Notion Build Bar 1:1 — Aug 28");
    expect(r.text).toContain("Alex Rivera will be your Notion expert");
    expect(r.html).toContain("<p ");
  });

  it("renders markdown formatting (bold) for the prep email", () => {
    const r = renderComms("prep_reminder", "guest", f())!;
    expect(r.html).toContain("<strong>");
  });

  it("drops a dangling separator when a token is empty", () => {
    const r = renderComms("assigned", "guest", f({ eventDate: null }))!;
    expect(r.subject).toBe("📅 Invitation: your Notion Build Bar 1:1");
  });

  it("expands the composite guestDetails block for expert emails", () => {
    const r = renderComms("assigned", "helper", f({ guestName: "Nancy Chen" }))!;
    expect(r.text).toContain("Guest Name: Nancy Chen");
  });

  it("uses a published override over the default (per field)", () => {
    const overrides: OverrideMap = new Map([
      ["assigned__guest", { subject: "Custom subject for {{firstName}}", body: "Hi {{firstName}}, custom body." }],
    ]);
    const r = renderComms("assigned", "guest", f({ guestName: "Nancy Chen" }), overrides)!;
    expect(r.subject).toBe("Custom subject for Nancy");
    expect(r.text).toContain("custom body");
  });

  it("links 'cancel your registration' to the event's public URL", () => {
    const r = renderComms("assigned", "guest", f({ eventUrl: "https://lu.ma/xyz" }))!;
    expect(r.html).toContain('href="https://lu.ma/xyz"');
    expect(r.html).toContain("cancel your registration");
  });

  it("returns null for an undefined kind×role", () => {
    expect(renderComms("no_show", "guest", f())).toBeNull();
  });

  it("double-booked lists all overlapping bookings (key info) + expert support line", () => {
    const r = renderComms("double_booked", "helper", f({
      conflicts: [
        { name: "Nancy Chen", role: "Community", company: "Notion", challenge: "Roadmap" },
        { name: "Jordan Lee", role: "PM", company: "Acme", challenge: "CRM" },
      ],
    }))!;
    expect(r.text).toContain("• Nancy Chen — Community, Notion — Challenge: Roadmap");
    expect(r.text).toContain("• Jordan Lee — PM, Acme — Challenge: CRM");
    expect(r.text).toContain("talk to Nancy Chen");
    expect(r.text).not.toContain("Guest Email:"); // no full details dump
  });
});
