import { describe, it, expect } from "vitest";
import { checkInEmail, cancellationEmail } from "@/lib/email/templates";

describe("checkInEmail", () => {
  it("includes guest, company, slot, and challenge", () => {
    const { subject, text } = checkInEmail({
      guestName: "Alex Rivera", company: "Brightwave",
      slotLabel: "2:00-2:30 PM", challenge: "Roadmap in Notion",
    });
    expect(subject).toContain("Alex Rivera");
    expect(text).toContain("Brightwave");
    expect(text).toContain("2:00-2:30 PM");
    expect(text).toContain("Roadmap in Notion");
  });
  it("omits missing optional lines cleanly", () => {
    const { text } = checkInEmail({ guestName: "Sam", company: null, slotLabel: null, challenge: null });
    expect(text).toContain("Sam");
    expect(text).not.toContain("Slot:");
  });
});

describe("cancellationEmail", () => {
  it("names the guest and slot", () => {
    const { subject, text } = cancellationEmail({ guestName: "Alex Rivera", slotLabel: "2:00-2:30 PM" });
    expect(subject).toContain("Alex Rivera");
    expect(text).toContain("2:00-2:30 PM");
    expect(text.toLowerCase()).toContain("cancel");
  });
});
