/**
 * Maps Luma's `approval_status` to a lifecycle action that the webhook handler
 * should execute. Centralises the "what do we do with this status?" decision so
 * the webhook route stays thin and testable.
 */
export type LifecycleAction = "create" | "cancel" | "ignore";

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
