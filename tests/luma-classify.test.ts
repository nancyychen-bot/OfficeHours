import { describe, it, expect } from "vitest";
import { classifyForm } from "@/lib/luma/classify";
import type { LumaRegistrationQuestion } from "@/lib/luma/types";

// A full, well-formed form (labels in Korean to prove language-independence).
const KOREAN: LumaRegistrationQuestion[] = [
  { id: "q1", type: "company", label: "회사" },
  { id: "q2", type: "text", label: "LinkedIn URL" },
  { id: "q3", type: "text", label: "이메일" },
  { id: "q4", type: "select", label: "요금제", options: ["Enterprise", "Business", "Plus", "Free"] },
  { id: "q5", type: "select", label: "경험", options: ["능숙함", "초보"] },
  { id: "q6", type: "select", label: "이유", options: ["1:1", "코워킹"] },
  { id: "q7", type: "long-text", label: "도움" },
  { id: "q8", type: "select", label: "시간대", options: ["2:00-2:30PM", "2:30-3:00PM"] },
];

describe("classifyForm", () => {
  it("returns no anomalies for a well-formed form in any language", () => {
    expect(classifyForm(KOREAN).anomalies).toEqual([]);
  });

  it("flags a missing time-slot question", () => {
    const noSlot = KOREAN.filter((q) => q.id !== "q8");
    const { anomalies } = classifyForm(noSlot);
    expect(anomalies.some((a) => /time-slot/i.test(a))).toBe(true);
  });

  it("flags the wrong number of free-text questions", () => {
    const oneText = KOREAN.filter((q) => q.id !== "q3"); // drop the email text question
    const { anomalies } = classifyForm(oneText);
    expect(anomalies.some((a) => /free-text/i.test(a))).toBe(true);
  });

  it("flags a missing plan question", () => {
    const noPlan = KOREAN.filter((q) => q.id !== "q4");
    expect(classifyForm(noPlan).anomalies.some((a) => /plan/i.test(a))).toBe(true);
  });

  it("does not throw on questions missing ids/types", () => {
    expect(() => classifyForm([{ label: "x" }])).not.toThrow();
  });
});
