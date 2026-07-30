export type LifecycleAction = "create" | "ignore" | "cancel";

/**
 * Map a Luma approval_status to what the hub should do. Only approved guests
 * become bookings; declined cancels; everything else (pending/waitlist/invited/
 * unknown) is ignored so un-vetted signups never reach the shared DB.
 */
export function lifecycleAction(approvalStatus: string | null | undefined): LifecycleAction {
  switch (approvalStatus) {
    case "approved":
      return "create";
    case "declined":
      return "cancel";
    default:
      return "ignore";
  }
}
