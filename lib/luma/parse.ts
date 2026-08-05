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

// Label pins for the finalized Build Bar form (case-insensitive `.test`).
const LABEL = {
  notionEmail: /email.*notion/i,
  notionPlan: /type of notion plan|notion plan/i,
  experience: /experience level/i,
  reasons: /why.*(come|build bar)/i,
  challenge: /help.*building|need help with/i,
  slot: /requested time slot|time slot/i,
};

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

  for (const a of answers) {
    const label = a.label ?? "";
    const type = (a.question_type ?? "").toLowerCase();
    const val = answerToString(a);

    if (type === "company") {
      out.company ??= val;
      out.role ??= jobTitleFromAnswer(a);
      continue;
    }
    if (LABEL.notionEmail.test(label)) { out.notionEmail ??= val; continue; }
    if (LABEL.notionPlan.test(label)) { out.notionPlan ??= val; continue; }
    if (LABEL.experience.test(label)) { out.experienceLevel ??= val; continue; }
    if (LABEL.reasons.test(label)) { out.attendReasons ??= val; continue; }
    if (LABEL.slot.test(label)) { out.requestedSlot ??= val; continue; }
    if (LABEL.challenge.test(label) || type === "long-text") { out.challenge ??= val; continue; }
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
