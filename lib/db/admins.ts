import { getAdminClient } from "../supabase/admin";

/** All admin emails (can unclaim any spot), alphabetical. */
export async function listAdmins(): Promise<string[]> {
  const { data } = await getAdminClient().from("admins").select("email").order("email");
  return (data ?? []).map((r) => r.email);
}

export async function addAdmin(email: string): Promise<void> {
  await getAdminClient().from("admins").upsert({ email: email.trim().toLowerCase() }, { onConflict: "email" });
}

export async function removeAdmin(email: string): Promise<void> {
  await getAdminClient().from("admins").delete().eq("email", email.trim().toLowerCase());
}

/**
 * True if this email may unclaim any spot: in the `admins` table OR the optional
 * UNCLAIM_ADMIN_EMAILS env (extra, no deploy needed). Case-insensitive.
 */
export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const extra = (process.env.UNCLAIM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (extra.includes(e)) return true;
  const { data } = await getAdminClient().from("admins").select("email").ilike("email", e).maybeSingle();
  return !!data;
}
