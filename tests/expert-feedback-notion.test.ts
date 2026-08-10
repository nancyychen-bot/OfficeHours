import { describe, it, expect } from "vitest";
import { expertFeedbackProperties } from "../lib/notion/expert-feedback";

describe("expertFeedbackProperties", () => {
  it("maps a fully-answered row to Notion properties, incl. the Booking relation", () => {
    const props = expertFeedbackProperties({
      booking_id: "b1", expert_email: "grace@x.com", expert_name: "Grace Hopper",
      guest_name: "Ada", guest_email: "ada@x.com",
      attended: true, rating: 5, note: "great chat",
      responded_at: "2026-08-26T22:00:00Z",
      slot_name: "2:00 PM", event_name: "NYC", event_date: "2026-08-26", location: "New York",
      booking_dev_page_id: "dev-page-123",
    });
    const json = JSON.stringify(props);
    expect(json).toContain("Grace Hopper");
    expect(json).toContain("great chat");
    expect(json).toContain("Showed up");
    expect((props["Rating"] as { number: number }).number).toBe(5);
    expect((props["Booking ID"] as { rich_text: Array<{ text: { content: string } }> }).rich_text[0].text.content).toBe("b1");
    expect((props["Booking"] as { relation: Array<{ id: string }> }).relation).toEqual([{ id: "dev-page-123" }]);
  });

  it("renders No-show, omits rating when null, and empty relation when no booking page", () => {
    const props = expertFeedbackProperties({
      booking_id: "b2", expert_email: "g@x.com", expert_name: "G",
      guest_name: "Bo", guest_email: null, attended: false, rating: null, note: null,
      responded_at: null, slot_name: null, event_name: null, event_date: null, location: null,
      booking_dev_page_id: null,
    });
    expect((props["Attended"] as { select: { name: string } | null }).select?.name).toBe("No-show");
    expect((props["Rating"] as { number: number | null }).number).toBeNull();
    expect((props["Booking"] as { relation: unknown[] }).relation).toEqual([]);
  });
});
