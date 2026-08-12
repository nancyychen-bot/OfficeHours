import { describe, it, expect } from "vitest";
import { generalFeedbackProperties } from "../lib/notion/expert-general-feedback";

describe("generalFeedbackProperties", () => {
  it("maps a general entry: type General, guest blank, note set", () => {
    const props = generalFeedbackProperties({
      expert_name: "Grace", expert_email: "g@x.com", note: "great venue, more outlets",
      event_name: "NYC", event_date: "2026-08-26", location: "New York", responded_at: "2026-08-26T22:00:00Z",
    });
    expect((props["Feedback type"] as { select: { name: string } }).select.name).toBe("General");
    expect((props["Note"] as { rich_text: Array<{ text: { content: string } }> }).rich_text[0].text.content).toContain("great venue");
    expect((props["Guest"] as { rich_text: unknown[] }).rich_text).toEqual([]);
  });
});
