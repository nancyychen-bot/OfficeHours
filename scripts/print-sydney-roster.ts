/**
 * Print the roster for the upcoming Sydney event — current state in the DB,
 * including each guest's assigned expert, slot, status, and whether an
 * `assigned__guest` or `slot_changed__guest` email was ever sent.
 *
 * Read-only. Does not send anything.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/print-sydney-roster.ts
 */
import { getAdminClient } from "../lib/supabase/admin";

interface Row {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  slot_name: string | null;
  slot_starts_at: string | null;
  booked_by_display_name: string | null;
  booked_by_email: string | null;
  status: string | null;
  event_name: string | null;
  event_date: string | null;
  event_id: string;
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;

  // Look at all events, prefer any whose name/city mentions "sydney".
  const today = new Date().toISOString().slice(0, 10);
  const { data: allEvents, error: evErr } = await supabase
    .from("events")
    .select("id, name, city, event_date, timezone, status")
    .gte("event_date", today)
    .order("event_date", { ascending: true });
  if (evErr) throw evErr;
  if (!allEvents || allEvents.length === 0) {
    console.log("No upcoming events at all.");
    return;
  }

  console.log("All upcoming events in DB:");
  for (const e of allEvents) console.log(`  - ${e.event_date}  ${e.city.padEnd(14)}  ${e.name}  [${e.status}]  tz=${e.timezone}  id=${e.id}`);
  console.log("");

  const sydney = allEvents.find(
    (e: { name: string; city: string }) =>
      e.city.toLowerCase().includes("sydney") || e.name.toLowerCase().includes("sydney"),
  );
  if (!sydney) {
    console.log("No upcoming event with 'sydney' in name/city.");
    return;
  }
  const ev = sydney;
  console.log(`Using: ${ev.name} — ${ev.city} — ${ev.event_date} (${ev.timezone})`);
  console.log(`Event ID: ${ev.id}\n`);

  const { data: rows, error } = await supabase
    .from("booking_details")
    .select("id, guest_name, guest_email, slot_name, slot_starts_at, booked_by_display_name, booked_by_email, status, event_name, event_date, event_id")
    .eq("event_id", ev.id);
  if (error) throw error;

  const bookings = (rows ?? []) as Row[];
  const claimed = bookings
    .filter((b) => b.status === "assigned" || b.status === "checked_in")
    .sort((a, b) => (a.slot_starts_at ?? "").localeCompare(b.slot_starts_at ?? ""));

  const ids = claimed.map((b) => b.id);
  const { data: logs } = await supabase
    .from("email_log")
    .select("booking_id, kind, status, created_at")
    .in("booking_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .in("kind", ["assigned", "slot_changed"]);
  const logMap = new Map<string, Array<{ kind: string; status: string; created_at: string }>>();
  for (const l of (logs ?? []) as Array<{ booking_id: string; kind: string; status: string; created_at: string }>) {
    const arr = logMap.get(l.booking_id) ?? [];
    arr.push({ kind: l.kind, status: l.status, created_at: l.created_at });
    logMap.set(l.booking_id, arr);
  }

  console.log(`Claimed bookings (status=assigned|checked_in): ${claimed.length}`);
  console.log(`Other bookings:                                 ${bookings.length - claimed.length}\n`);

  const fmtLocal = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-AU", { timeZone: ev.timezone, hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

  const header = ["Local time", "Slot", "Guest", "Guest email", "Expert", "Expert email", "Status", "Assigned-email", "Slot-change-email"];
  const widths = header.map((h) => h.length);
  const asRow = (b: Row) => {
    const log = logMap.get(b.id) ?? [];
    const assignedSent = log.find((l) => l.kind === "assigned" && l.status === "sent");
    const slotChangedSent = log.find((l) => l.kind === "slot_changed" && l.status === "sent");
    return [
      fmtLocal(b.slot_starts_at),
      b.slot_name ?? "—",
      b.guest_name ?? "—",
      b.guest_email ?? "—",
      b.booked_by_display_name ?? "—",
      b.booked_by_email ?? "—",
      b.status ?? "—",
      assignedSent ? `sent ${assignedSent.created_at.slice(0, 10)}` : "no",
      slotChangedSent ? `sent ${slotChangedSent.created_at.slice(0, 10)}` : "—",
    ];
  };
  const rowsStr = claimed.map(asRow);
  for (const r of rowsStr) r.forEach((cell, i) => { widths[i] = Math.max(widths[i], cell.length); });

  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of rowsStr) console.log(line(r));
  console.log("");

  const stale = claimed.filter((b) => !(logMap.get(b.id) ?? []).find((l) => l.kind === "assigned" && l.status === "sent"));
  if (stale.length) {
    console.log(`⚠️  ${stale.length} claimed booking(s) never got an "assigned__guest" email — if the slot was manually set in Notion, the guest likely does NOT know their time:`);
    for (const b of stale) console.log(`   - ${b.guest_name} (${b.guest_email}) — slot: ${b.slot_name}`);
    console.log("");
  }

  const changedButNoNotice = claimed.filter((b) => {
    const log = logMap.get(b.id) ?? [];
    const assignedSent = log.find((l) => l.kind === "assigned" && l.status === "sent");
    const slotChangedSent = log.find((l) => l.kind === "slot_changed" && l.status === "sent");
    return assignedSent && !slotChangedSent;
  });
  console.log(`Note: ${changedButNoNotice.length} claimed bookings got the original "assigned" email but no slot-change email. If their slot moved after that assigned email, they have stale info.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
