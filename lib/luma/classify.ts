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
// Require ≥2 plan-tier options (not ALL), so an added "Other"/"Not sure" option
// on the plan question doesn't make it undetectable. Experience/reasons options
// are never tier names, so this won't misfire on them.
const isPlan = (q: LumaRegistrationQuestion) => optionStrings(q).filter((o) => PLAN_VALUE.test(o.trim())).length >= 2;

// The Build Bar template has exactly 5 non-options (free-text/other) questions:
// company, LinkedIn, Notion email, the 1:1-help (challenge) prose, and the consent
// checkbox. An extra one can collide with the challenge field at ingest (challenge
// = "the remaining free-text answer"), so flag any excess for the operator to
// verify. Update this if the template itself gains/loses a non-options question.
const TEMPLATE_NON_OPTION_QUESTIONS = 5;

/**
 * Validate that a Luma registration form matches the Build Bar template SHAPE.
 *
 * IMPORTANT: Luma's event-detail `registration_questions` carry only `{id, label,
 * options}` — there is NO `type` on the question definition (only the per-guest
 * `registration_answers` carry a `question_type`). So the only language-independent
 * signals available here are the OPTION VALUES. We validate the three
 * options-backed questions — plan (tier options), slot (clock-time options), and
 * at least one experience/reasons question — and deliberately do NOT try to
 * validate the free-text questions (company/email/challenge/consent are all just
 * `{id, label}` and indistinguishable without reading the label's language). Those
 * free-text fields are resolved at INGEST by value shape regardless, so a missing
 * one surfaces there, not here.
 *
 * Returns human-readable anomaly strings; empty ⇒ the form's options questions
 * match the template. Used only for the operator alert — ingest does not depend
 * on it.
 */
export function classifyForm(questions: LumaRegistrationQuestion[]): { anomalies: string[] } {
  const qs = questions ?? [];
  const anomalies: string[] = [];

  if (!qs.some(isPlan)) {
    anomalies.push("no question with plan-tier options (Enterprise/Business/Plus/Free)");
  }
  if (!qs.some(isTimeSlot)) {
    anomalies.push("no question with time-slot options");
  }
  // Options questions that are NOT plan and NOT slot are the experience/reasons
  // questions; the template has at least one such question beyond plan/slot.
  const otherOptionQs = qs.filter((q) => hasOptions(q) && !isPlan(q) && !isTimeSlot(q)).length;
  if (otherOptionQs === 0) {
    anomalies.push("no experience/reasons options question");
  }

  // An extra free-text question beyond the template can be mis-captured as the
  // guest's `challenge`. We can't tell free-text questions apart here (the form
  // definition carries no `type`), so count all non-options questions and flag
  // any excess over the template for a human to eyeball.
  const nonOptions = qs.filter((q) => !hasOptions(q)).length;
  if (nonOptions > TEMPLATE_NON_OPTION_QUESTIONS) {
    anomalies.push(
      `${nonOptions} free-text/other questions (template has ${TEMPLATE_NON_OPTION_QUESTIONS}) — an extra free-text question can collide with the 1:1-help field; verify the guest "challenge" maps correctly`,
    );
  }

  return { anomalies };
}
