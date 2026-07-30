# Notion check-in notification (per Bookings DB)

Set this up once in EACH Bookings database (Notion Dev and Ambassador) so the
assigned helper gets an in-app Notion notification when their guest checks in.
(The hub also sends an email; this is the in-Notion channel.)

1. Open the Bookings database → ••• → **Automations** → **New automation**.
2. **Trigger:** `Status` is edited → set to **Checked In**.
3. **Action:** **Notify** → **Person in "Booked by"** (the native people property).
4. Save.

Why it works: the hub sets Status → Checked In on both pages when the guest
scans in at Luma. Only the workspace where the claimer is a real Person will
actually notify someone; the other side's "Booked by" is empty and no-ops.
No hub code involved.
