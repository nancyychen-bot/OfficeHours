import { describe, it, expect } from "vitest";
import { classifyForm } from "@/lib/luma/classify";
import type { LumaRegistrationQuestion } from "@/lib/luma/types";

// A full, well-formed form mirroring the REAL Luma event-detail shape: questions
// carry only { id, label, options } — NO `type` field (only per-guest answers do).
// Labels are Korean to prove classification is language-independent (options only).
const KOREAN: LumaRegistrationQuestion[] = [
  { id: "q1", label: "회사" }, // company — no options
  { id: "q2", label: "LinkedIn URL" }, // linkedin — no options
  { id: "q3", label: "이메일" }, // email — no options
  { id: "q4", label: "요금제", options: ["Enterprise", "Business", "Plus", "Free"] }, // plan
  { id: "q5", label: "경험", options: ["파워 유저", "능숙함", "어느 정도", "입문자"] }, // experience
  { id: "q6", label: "이유", options: ["1:1 도움이 필요해요", "코워킹", "둘러보러"] }, // reasons
  { id: "q7", label: "1:1 도움" }, // challenge — no options
  { id: "q8", label: "희망 시간대", options: ["2:00-2:30PM", "2:30-3:00PM"] }, // slot
  { id: "q9", label: "동의" }, // consent — no options
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

  it("flags a missing plan question", () => {
    const noPlan = KOREAN.filter((q) => q.id !== "q4");
    expect(classifyForm(noPlan).anomalies.some((a) => /plan/i.test(a))).toBe(true);
  });

  it("still detects the plan question when it has an extra non-tier option", () => {
    const withOther = KOREAN.map((q) =>
      q.id === "q4" ? { ...q, options: ["Enterprise", "Business", "Plus", "Free", "Not sure"] } : q,
    );
    expect(classifyForm(withOther).anomalies.some((a) => /plan/i.test(a))).toBe(false);
  });

  it("flags when there is no experience/reasons options question", () => {
    // Remove BOTH experience and reasons; only plan + slot options remain.
    const noOther = KOREAN.filter((q) => q.id !== "q5" && q.id !== "q6");
    expect(classifyForm(noOther).anomalies.some((a) => /experience\/reasons/i.test(a))).toBe(true);
  });

  it("does not flag experience/reasons when at least one such question remains", () => {
    const oneOther = KOREAN.filter((q) => q.id !== "q6"); // drop reasons, keep experience
    expect(classifyForm(oneOther).anomalies.some((a) => /experience\/reasons/i.test(a))).toBe(false);
  });

  it("does not throw on questions missing ids/labels/options", () => {
    expect(() => classifyForm([{ label: "x" }])).not.toThrow();
  });
});
