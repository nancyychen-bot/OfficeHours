import type { NormalizedRegistration } from "../luma/parse";
import type { LumaStatus } from "../sync/types";

/** A host-invited guest bypasses the Luma registration form, so NONE of the
 * mapped form fields are present. (Name/email come from the invite, not answers.) */
export function isInvitedGuest(norm: NormalizedRegistration): boolean {
  return (
    !norm.requestedSlot &&
    !norm.challenge &&
    !norm.role &&
    !norm.company &&
    !norm.experienceLevel &&
    !norm.attendReasons &&
    !norm.notionPlan
  );
}

/** Gate for the auto-send: only an approved, zero-answer guest on the LIVE webhook
 * (never during silent backfill) is prompted to complete the form. */
export function shouldSendCompletion(p: { invited: boolean; lumaStatus: LumaStatus; live: boolean }): boolean {
  return p.invited && p.live && p.lumaStatus === "approved";
}
