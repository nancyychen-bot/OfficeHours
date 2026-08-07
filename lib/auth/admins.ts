// Admins (can unclaim any spot) are managed in the `admins` DB table via the hub
// Settings → Admins page. `isAdminEmail` also honours the optional
// UNCLAIM_ADMIN_EMAILS env for extras without a deploy.
export { isAdminEmail as isUnclaimAdmin } from "../db/admins";
