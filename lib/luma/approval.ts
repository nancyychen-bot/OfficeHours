import type { LumaStatus } from "../sync/types";

/**
 * Map Luma's `approval_status` to the hub's approval axis. Everything that isn't
 * an explicit approved/declined/waitlist is treated as pending (untriaged), so
 * un-triaged signups land in the DB as Pending for Notion-side triage.
 */
export function approvalStatusToLumaStatus(approvalStatus: string | null | undefined): LumaStatus {
  switch (approvalStatus) {
    case "approved":
      return "approved";
    case "declined":
      return "declined";
    case "waitlist":
      return "waitlist";
    default:
      return "pending";
  }
}
