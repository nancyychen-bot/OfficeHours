import type { LumaGuestData, LumaRegistrationAnswer } from "./types";

export interface NormalizedRegistration {
  lumaGuestId: string;
  lumaEventId: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  role: string | null;
  company: string | null;
  challenge: string | null;
  notionEmail: string | null;
  notionPlan: string | null;
  experienceLevel: string | null;
  attendReasons: string | null;
  requestedSlot: string | null;
  isCheckedIn: boolean;
  approvalStatus: string | null;
}

/** Pull a primitive string out of a registration answer, whatever its type. */
export function answerToString(answer: LumaRegistrationAnswer): string | null {
  const v = answer.value;
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.filter(Boolean).join(", ") || null;
  if (typeof v === "object") {
    // e.g. company type: { company, job_title }
    const obj = v as Record<string, unknown>;
    const company = typeof obj.company === "string" ? obj.company : null;
    return company;
  }
  return null;
}

function jobTitleFromAnswer(answer: LumaRegistrationAnswer): string | null {
  if (answer.value && typeof answer.value === "object" && !Array.isArray(answer.value)) {
    const obj = answer.value as Record<string, unknown>;
    if (typeof obj.job_title === "string") return obj.job_title.trim() || null;
  }
  return null;
}

// Label pins for the Build Bar form. The form is translated per region (Seoul
// renamed every label into Korean), so each field carries patterns for every
// language we've seen — add the next locale's phrasing here. Matching is still
// backstopped by `question_type` (company/long-text) and, below, by
// language-independent answer VALUES, so a brand-new locale degrades gracefully
// instead of silently dropping fields.
const LABEL: Record<"notionEmail" | "notionPlan" | "experience" | "reasons" | "challenge" | "slot", RegExp[]> = {
  notionEmail: [/email.*notion/i, /notion.*email/i, /이메일/],
  notionPlan: [/type of notion plan/i, /notion plan/i, /요금제/],
  experience: [/experience level/i, /경험/],
  reasons: [/why.*(come|build bar)/i, /이유/],
  challenge: [/help.*building/i, /need help with/i, /help.*require/i, /require.*help/i, /도움.*필요|필요.*도움/],
  slot: [/requested time slot/i, /time slot/i, /시간대/],
};

const matchesAny = (label: string, patterns: RegExp[]): boolean => patterns.some((p) => p.test(label));

// Language-independent value signatures. The option/answer VALUES for these
// questions are identical across languages (clock times, plan tiers, an email
// address, a URL), so they identify a field without reading any label text.
// A slot value is a clock-time RANGE (e.g. "2:30-3:00PM", "2:00–2:30 PM") — always
// two times joined by a dash/tilde in real Build Bar forms. Requiring the range
// (not a bare clock) keeps a reasons/experience option that merely mentions a time
// (e.g. "Available after 2:30") from being misclaimed as the slot.
const TIME_RANGE = /\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?\s*[-–—~]\s*\d{1,2}:\d{2}/i;
const PLAN_VALUE = /^(enterprise|business|plus|free)$/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_VALUE = /^https?:\/\//i;

/** A clock-time RANGE anywhere in the value — a plain string or any array element. */
function hasClockTime(value: unknown): boolean {
  if (typeof value === "string") return TIME_RANGE.test(value);
  if (Array.isArray(value)) return value.some((v) => typeof v === "string" && TIME_RANGE.test(v));
  return false;
}

/** A single/multi select or dropdown (not free text, not company). */
function isSelectType(type: string): boolean {
  return /select|dropdown|choice/.test(type);
}

function mapAnswers(answers: LumaRegistrationAnswer[]): {
  role: string | null;
  company: string | null;
  challenge: string | null;
  notionEmail: string | null;
  notionPlan: string | null;
  experienceLevel: string | null;
  attendReasons: string | null;
  requestedSlot: string | null;
} {
  const out = {
    role: null as string | null,
    company: null as string | null,
    challenge: null as string | null,
    notionEmail: null as string | null,
    notionPlan: null as string | null,
    experienceLevel: null as string | null,
    attendReasons: null as string | null,
    requestedSlot: null as string | null,
  };

  // Tiebreaker: `challenge` is otherwise "the first remaining free-text answer",
  // which a SECOND free-text question (e.g. an added "dietary restrictions?" field)
  // could win by appearing earlier. Prefer the free-text answer whose LABEL names
  // the 1:1-help question (multilingual patterns) so position doesn't matter. When
  // no label matches (a brand-new locale), the main loop still falls back to the
  // first free-text answer — and classifyForm flags the extra question for review.
  for (const a of answers) {
    const type = (a.question_type ?? "").toLowerCase();
    const isFreeText = type === "long-text" || type === "text" || type === "short-text";
    if (isFreeText && matchesAny(a.label ?? "", LABEL.challenge)) {
      out.challenge = answerToString(a);
      break;
    }
  }

  for (const a of answers) {
    const label = a.label ?? "";
    const type = (a.question_type ?? "").toLowerCase();
    const val = answerToString(a);

    // 1. Company (by type) → company + role.
    if (type === "company") { out.company ??= val; out.role ??= jobTitleFromAnswer(a); continue; }
    // 2. Slot — a clock-time value (string "2:30-3:00PM" or an array of times).
    if (hasClockTime(a.value)) { out.requestedSlot ??= val; continue; }
    // 3. Plan — the tier set is identical in every language.
    if (val && PLAN_VALUE.test(val)) { out.notionPlan ??= val; continue; }
    // 4. Reasons — the multi-select (its value is an array); slot already took times.
    if (Array.isArray(a.value)) { out.attendReasons ??= val; continue; }
    // 5. Notion email — an email-shaped value.
    if (val && EMAIL_VALUE.test(val)) { out.notionEmail ??= val; continue; }
    // 6. LinkedIn — a URL value, or a label with the universal brand token → ignore.
    if (val && URL_VALUE.test(val)) continue;
    if (/linkedin/i.test(label)) continue;
    // 7. Experience — the remaining single-select string.
    if (isSelectType(type)) { out.experienceLevel ??= val; continue; }
    // 8. Challenge — the remaining free text.
    if (type === "long-text" || type === "text" || type === "short-text") { out.challenge ??= val; continue; }
  }

  // Last-ditch fallback: if a field is still unmapped (an unusual payload), try the
  // multilingual label patterns. These are no longer load-bearing — the loop above
  // resolves the standard template — but they add robustness for an odd form.
  for (const a of answers) {
    const label = a.label ?? "";
    const val = answerToString(a);
    if (out.notionEmail == null && matchesAny(label, LABEL.notionEmail)) { out.notionEmail = val; continue; }
    if (out.notionPlan == null && matchesAny(label, LABEL.notionPlan)) { out.notionPlan = val; continue; }
    if (out.experienceLevel == null && matchesAny(label, LABEL.experience)) { out.experienceLevel = val; continue; }
    if (out.attendReasons == null && matchesAny(label, LABEL.reasons)) { out.attendReasons = val; continue; }
    if (out.requestedSlot == null && matchesAny(label, LABEL.slot)) { out.requestedSlot = val; continue; }
    if (out.challenge == null && matchesAny(label, LABEL.challenge)) { out.challenge = val; continue; }
  }
  return out;
}

function displayName(data: LumaGuestData): string {
  if (data.user_name && data.user_name.trim()) return data.user_name.trim();
  const composed = [data.user_first_name, data.user_last_name]
    .filter((p): p is string => !!p && !!p.trim())
    .join(" ")
    .trim();
  return composed || data.user_email;
}

/** True if the guest has checked in on ANY ticket (check-in is per-ticket in Luma). */
export function isCheckedIn(data: LumaGuestData): boolean {
  return (data.event_tickets ?? []).some((t) => !!t.checked_in_at);
}

/** Normalize a Luma guest payload into the fields the hub stores. */
export function normalizeGuest(data: LumaGuestData): NormalizedRegistration {
  const answers = data.registration_answers ?? [];
  const mapped = mapAnswers(answers);
  return {
    lumaGuestId: data.id,
    lumaEventId: data.event.id,
    guestName: displayName(data),
    guestEmail: data.user_email,
    guestPhone: data.phone_number ?? null,
    role: mapped.role,
    company: mapped.company,
    challenge: mapped.challenge,
    notionEmail: mapped.notionEmail,
    notionPlan: mapped.notionPlan,
    experienceLevel: mapped.experienceLevel,
    attendReasons: mapped.attendReasons,
    requestedSlot: mapped.requestedSlot,
    isCheckedIn: isCheckedIn(data),
    approvalStatus: data.approval_status ?? null,
  };
}
