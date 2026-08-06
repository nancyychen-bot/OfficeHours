// Emails allowed to unclaim ANY spot (not just their own). Everyone else can only
// unclaim a 1:1 they personally claimed. Extend via UNCLAIM_ADMIN_EMAILS (comma-
// separated) without a code change, or edit this list.
const DEFAULT_ADMINS = [
  // TEMP (refusal test 2026-08-06): nchen removed so Nancy can experience a refusal.
  // RESTORE this line right after the test.
  // "nchen@makenotion.com",
  "eyy@makenotion.com",
  "vanessa.intan@makenotion.com",
  "faisa.mohamed@makenotion.com",
];

export function isUnclaimAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const extra = (process.env.UNCLAIM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const all = new Set([...DEFAULT_ADMINS.map((e) => e.toLowerCase()), ...extra]);
  return all.has(email.trim().toLowerCase());
}
