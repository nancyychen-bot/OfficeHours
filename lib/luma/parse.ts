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
  requestedSlotLabel: string | null;
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

const RE = {
  challenge: /challenge|help|working on|struggl|goal|need/i,
  role: /role|title|position|job/i,
  company: /company|organization|employer|where.*work/i,
  slot: /slot|time|session/i,
};

/**
 * Map custom registration answers to our fields (PRD §5).
 *
 * The Luma form isn't locked yet, so this matches on question label + type.
 * Once the questions are finalized, pin these to explicit `question_id`s (the
 * ids are stable and available from Get Event → registration_questions).
 */
function mapAnswers(answers: LumaRegistrationAnswer[]): {
  role: string | null;
  company: string | null;
  challenge: string | null;
  requestedSlotLabel: string | null;
} {
  let role: string | null = null;
  let company: string | null = null;
  let challenge: string | null = null;
  let requestedSlotLabel: string | null = null;

  for (const a of answers) {
    const label = a.label ?? "";
    const asString = answerToString(a);

    if (a.question_type === "company") {
      company = company ?? answerToString(a);
      role = role ?? jobTitleFromAnswer(a);
      continue;
    }
    if (!requestedSlotLabel && (RE.slot.test(label) || a.question_type === "dropdown")) {
      if (RE.slot.test(label)) requestedSlotLabel = asString;
    }
    if (!challenge && RE.challenge.test(label)) challenge = asString;
    else if (!role && RE.role.test(label)) role = asString;
    else if (!company && RE.company.test(label)) company = asString;
  }

  return { role, company, challenge, requestedSlotLabel };
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
    requestedSlotLabel: mapped.requestedSlotLabel,
    isCheckedIn: isCheckedIn(data),
    approvalStatus: data.approval_status ?? null,
  };
}
