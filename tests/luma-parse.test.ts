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

// The form is translated per region (Seoul renamed every label into Korean), so
// label text can't be the only signal. These lock in that a fully-Korean form
// still maps every field — via Korean label patterns and, for fields whose
// option values are themselves language-independent, value-based backstops.
const KOREAN_ANSWERS = [
  { label: "어느 회사에서 일하고 계신가요?", question_id: "q1", question_type: "company", value: { company: "Analytical", job_title: "엔지니어" } },
  { label: "Notion에서 사용하는 이메일은 무엇인가요?", question_id: "q2", question_type: "text", value: "ada@notion.so" },
  { label: "어떤 Notion 요금제를 사용 중이신가요?", question_id: "q3", question_type: "single-select", value: "Business" },
  { label: "Notion 사용 경험이 어느 정도이신 것 같으신가요?", question_id: "q4", question_type: "single-select", value: "능숙해요 - 어느 정도 익숙해요" },
  { label: "Build Bar에 오고 싶은 이유는 무엇인가요?", question_id: "q5", question_type: "multi-select", value: ["1:1 도움이 필요해요", "함께 코워킹하고 싶어요"] },
  { label: "1:1 도움을 원하신다면, 어떤 도움을 만드는 데 도움이 필요하신가요?", question_id: "q6", question_type: "long-text", value: "CRM 만들기" },
  { label: "희망 시간대 (1:1 도움을 선택하셨으면 필수)", question_id: "q7", question_type: "checkbox", value: ["2:00-2:30PM"] },
];

describe("normalizeGuest — non-English (Korean) intake mapping", () => {
  it("maps every field from a fully-translated Korean form", () => {
    const n = normalizeGuest(guest(KOREAN_ANSWERS));
    expect(n.company).toBe("Analytical");
    expect(n.role).toBe("엔지니어");
    expect(n.notionEmail).toBe("ada@notion.so");
    expect(n.notionPlan).toBe("Business");
    expect(n.experienceLevel).toBe("능숙해요 - 어느 정도 익숙해요");
    expect(n.attendReasons).toBe("1:1 도움이 필요해요, 함께 코워킹하고 싶어요");
    expect(n.challenge).toBe("CRM 만들기");
    expect(n.requestedSlot).toBe("2:00-2:30PM");
  });

  it("falls back to value signals when a label is in an unknown language (plan tier, time slot, email)", () => {
    // Labels that match NO dictionary pattern in any language: the known-value
    // backstops must still recover plan, slot, and the Notion email.
    const n = normalizeGuest(
      guest([
        { label: "¿Qué plan de Notion usas?", question_id: "p1", question_type: "single-select", value: "Enterprise" },
        { label: "¿Qué correo usas?", question_id: "p2", question_type: "text", value: "jose@notion.so" },
        { label: "Franja horaria preferida", question_id: "p3", question_type: "checkbox", value: ["3:00-3:30 PM"] },
      ]),
    );
    expect(n.notionPlan).toBe("Enterprise");
    expect(n.notionEmail).toBe("jose@notion.so");
    expect(n.requestedSlot).toBe("3:00-3:30 PM");
  });

  it("does not let the value backstops hijack the LinkedIn URL or a plain text answer", () => {
    const n = normalizeGuest(
      guest([
        { label: "LinkedIn URL", question_id: "l1", question_type: "text", value: "https://linkedin.com/in/ada" },
      ]),
    );
    expect(n.notionEmail).toBeNull();
    expect(n.requestedSlot).toBeNull();
    expect(n.notionPlan).toBeNull();
  });
});
