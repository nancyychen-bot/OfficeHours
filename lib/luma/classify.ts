import type { LumaRegistrationQuestion } from "./types";

const CLOCK_TIME = /\d{1,2}:\d{2}/;
const PLAN_VALUE = /^(enterprise|business|plus|free)$/i;

function optionStrings(q: LumaRegistrationQuestion): string[] {
  return (q.options ?? []).map((o) => {
    if (typeof o === "string") return o;
    if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      for (const k of ["label", "name", "value", "text"]) if (typeof r[k] === "string") return r[k] as string;
    }
    return String(o);
  });
}

const hasOptions = (q: LumaRegistrationQuestion) => Array.isArray(q.options) && q.options.length > 0;
const isTimeSlot = (q: LumaRegistrationQuestion) => optionStrings(q).some((s) => CLOCK_TIME.test(s));
const isPlan = (q: LumaRegistrationQuestion) => { const s = optionStrings(q); return s.length > 0 && s.every((o) => PLAN_VALUE.test(o.trim())); };
const isFreeText = (q: LumaRegistrationQuestion) => { const t = (q.type ?? "").toLowerCase(); return !hasOptions(q) && t !== "company" && /text/.test(t); };
const isLinkedIn = (q: LumaRegistrationQuestion) => /linkedin/i.test(q.label ?? "");

/**
 * Validate that a Luma registration form matches the Build Bar template SHAPE,
 * using option values + question type only (never label text, so it is
 * language-independent). Returns human-readable anomaly strings; empty ⇒ the form
 * is well-formed. Used only for the operator alert — ingest does not depend on it.
 */
export function classifyForm(questions: LumaRegistrationQuestion[]): { anomalies: string[] } {
  const qs = questions ?? [];
  const anomalies: string[] = [];

  if (!qs.some((q) => (q.type ?? "").toLowerCase() === "company")) {
    anomalies.push("no company question");
  }
  const planCount = qs.filter(isPlan).length;
  if (planCount === 0) anomalies.push("no question with plan-tier options (Enterprise/Business/Plus/Free)");

  const slotCount = qs.filter(isTimeSlot).length;
  if (slotCount === 0) anomalies.push("no question with time-slot options");

  // Options questions that are NOT plan and NOT slot are the experience + reasons
  // pair; the template has at least one (experience) beyond plan/slot.
  const otherOptionQs = qs.filter((q) => hasOptions(q) && !isPlan(q) && !isTimeSlot(q)).length;
  if (otherOptionQs === 0) anomalies.push("no experience/reasons options question");

  const freeText = qs.filter((q) => isFreeText(q) && !isLinkedIn(q)).length;
  if (freeText !== 2) anomalies.push(`expected 2 free-text questions (email + 1:1 help), found ${freeText}`);

  return { anomalies };
}
