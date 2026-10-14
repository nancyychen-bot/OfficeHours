import type { LumaGuestData } from "@/lib/luma/types";

export interface SubmittedAnswer { label: string; kind: "text" | "select" | "slot"; value: string | string[] }
export interface BuildInput {
  lumaGuestId: string;
  guestEmail: string;
  lumaEventId: string;
  answers: SubmittedAnswer[];
  /** Carried through from the existing booking so the replayed upsert preserves
   * the invited guest's name/phone (which the webhook set) instead of nulling them. */
  guestName?: string | null;
  guestPhone?: string | null;
}

/** Map the form's per-question kind to a Luma question_type the value-shape
 * mapper (lib/luma/parse.ts) understands. "slot"/"select" → dropdown; "text" →
 * long-text (so a free-text challenge is picked up even without a Luma type). */
function questionType(kind: SubmittedAnswer["kind"]): string {
  return kind === "text" ? "long-text" : "dropdown";
}

/** True if a submitted value carries real content (ignore empty strings/arrays). */
function hasValue(value: string | string[]): boolean {
  return Array.isArray(value) ? value.length > 0 : String(value).trim().length > 0;
}

/** Reconstruct a Luma-shaped guest payload from the completion form's answers so
 * it can be replayed through normalizeGuest → ingestRegistration unchanged. */
export function buildGuestData(input: BuildInput): LumaGuestData {
  return {
    id: input.lumaGuestId,
    user_email: input.guestEmail,
    user_name: input.guestName ?? null,
    phone_number: input.guestPhone ?? null,
    approval_status: "approved",
    event: { id: input.lumaEventId },
    registration_answers: input.answers
      .filter((a) => hasValue(a.value))
      .map((a) => ({ label: a.label, question_id: "", question_type: questionType(a.kind), value: a.value })),
  };
}
