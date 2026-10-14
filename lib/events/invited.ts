import type { NormalizedRegistration } from "../luma/parse";

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
