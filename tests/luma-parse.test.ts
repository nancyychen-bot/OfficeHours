import { describe, it, expect } from "vitest";
import { normalizeGuest } from "@/lib/luma/parse";
import type { LumaGuestData } from "@/lib/luma/types";

function guest(answers: LumaGuestData["registration_answers"]): LumaGuestData {
  return {
    id: "gst-1",
    user_email: "ada@x.com",
    user_name: "Ada Lovelace",
    approval_status: "pending",
    registration_answers: answers,
    event_tickets: [],
    event: { id: "evt-1" },
  };
}

const ANSWERS = [
  { label: "What company do you work for?", question_id: "q1", question_type: "company", value: { company: "Analytical", job_title: "Engineer" } },
  { label: "What email do you use for Notion?", question_id: "q2", question_type: "text", value: "ada@notion.so" },
  { label: "What type of Notion plan are you on?", question_id: "q3", question_type: "dropdown", value: "Business" },
  { label: "How would you rate your experience level with Notion?", question_id: "q4", question_type: "dropdown", value: "Confident - I know my way around" },
  { label: "Why do you want to come to Build Bar?", question_id: "q5", question_type: "multi-select", value: ["I need 1:1 help", "I want to cowork"] },
  { label: "If you're looking for 1:1 support, what would you need help with building?", question_id: "q6", question_type: "long-text", value: "A CRM" },
  { label: "Requested time slot for 1:1 help (if needed)", question_id: "q7", question_type: "dropdown", value: "2:00–2:30 PM" },
];

describe("normalizeGuest — intake mapping", () => {
  it("pins every field by label", () => {
    const n = normalizeGuest(guest(ANSWERS));
    expect(n.company).toBe("Analytical");
    expect(n.role).toBe("Engineer");
    expect(n.notionEmail).toBe("ada@notion.so");
    expect(n.notionPlan).toBe("Business");
    expect(n.experienceLevel).toBe("Confident - I know my way around");
    expect(n.attendReasons).toBe("I need 1:1 help, I want to cowork");
    expect(n.challenge).toBe("A CRM");
    expect(n.requestedSlot).toBe("2:00–2:30 PM");
  });

  it("leaves requestedSlot null when the slot question is unanswered", () => {
    const n = normalizeGuest(guest(ANSWERS.filter((a) => a.question_id !== "q7")));
    expect(n.requestedSlot).toBeNull();
  });
});
