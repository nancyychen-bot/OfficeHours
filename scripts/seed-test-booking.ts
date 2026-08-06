/** TEMP: seed one test event + booking (guest = nchen@) and push to both Notion
 * DBs, so we can live-test Claim/Unclaim. Delete after testing. */
import { getAdminClient } from "../lib/supabase/admin";
import { upsertEvent } from "../lib/db/events";
import { getBookingById } from "../lib/db/bookings";
import { pushBookingToWorkspaces } from "../lib/notion/push";

async function main() {
  const supabase = getAdminClient();

  // Tomorrow, 2:00–2:30 PM PT (21:00–21:30 UTC).
  const d = new Date(Date.now() + 86_400_000);
  const day = d.toISOString().slice(0, 10);
  const startsAt = `${day}T21:00:00Z`;
  const endsAt = `${day}T21:30:00Z`;
  const SLOT = "2:00–2:30 PM";

  const event = await upsertEvent({
    lumaEventId: "evt-test-claimflow",
    name: "[TEST] Claim Flow",
    city: "Test City",
    address: "123 Test St, Test City",
    publicUrl: "https://lu.ma/testclaimflow",
    eventDate: day,
    timezone: "America/Los_Angeles",
    status: "planned",
  });

  // Slot (idempotent-ish: clear existing test slots first).
  await supabase.from("slots").delete().eq("event_id", event.id);
  const { data: slot, error: se } = await supabase
    .from("slots")
    .insert({ event_id: event.id, name: SLOT, starts_at: startsAt, ends_at: endsAt })
    .select("*")
    .single();
  if (se) throw se;

  const { data: booking, error: be } = await supabase
    .from("bookings")
    .upsert(
      {
        luma_guest_id: "gst-test-claimflow",
        event_id: event.id,
        slot_id: slot.id,
        guest_name: "Test Guest",
        guest_email: "nchen@makenotion.com",
        role: "Tester",
        company: "Notion",
        challenge: "Testing the claim flow",
        requested_slot: SLOT,
        status: "unassigned",
        luma_status: "approved",
      },
      { onConflict: "luma_guest_id" },
    )
    .select("*")
    .single();
  if (be) throw be;

  const full = (await getBookingById(booking.id)) ?? booking;
  const push = await pushBookingToWorkspaces(full, {
    fullUpdate: true,
    dev: { slotLabel: SLOT, location: event.city, eventName: event.name, eventDate: event.event_date },
    ambassador: { slotLabel: SLOT, location: event.city, eventName: event.name, eventDate: event.event_date },
  });
  console.log("event:", event.name, "| booking:", booking.id, "| push:", JSON.stringify(push));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
