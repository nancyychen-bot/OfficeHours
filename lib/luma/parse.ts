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
 * Primarily by question TYPE (dropdown→slot, long-text→challenge, company→
 * company/role), with label keywords only as a fallback. Each answer is claimed
 * by at most ONE field (note the `continue`s) so a slot question labelled
 * "…for 1:1 help" can't also leak into challenge. Pin to explicit question_ids
 * once the form is finalized for full determinism.
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
    const type = (a.question_type ?? "").toLowerCase();
    const val = answerToString(a);

    // Company question type carries both company and job title (→ role).
    if (type === "company") {
      if (!company) company = val;
      if (!role) role = jobTitleFromAnswer(a);
      continue;
    }
    // Slot: the dropdown (or a slot/time-labelled question). Claim it exclusively.
    if (!requestedSlotLabel && (type === "dropdown" || RE.slot.test(label))) {
      requestedSlotLabel = val;
      continue;
    }
    // Challenge: a long-text question (or a challenge-labelled one).
    if (!challenge && (type === "long-text" || RE.challenge.test(label))) {
      challenge = val;
      continue;
    }
    if (!role && RE.role.test(label)) {
      role = val;
      continue;
    }
    if (!company && RE.company.test(label)) {
      company = val;
      continue;
    }
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
