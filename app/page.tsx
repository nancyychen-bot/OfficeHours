import { listBookings, listSlots, listEvents, syncSummary } from "@/lib/hub/queries";
import { Dashboard } from "@/components/hub/Dashboard";

// Always render fresh (reads the live DB); the middleware guards access.
export const dynamic = "force-dynamic";

export default async function HubPage() {
  const [bookings, slots, events, summary] = await Promise.all([
    listBookings(),
    listSlots(),
    listEvents(),
    syncSummary(),
  ]);
  return (
    <Dashboard
      bookings={bookings}
      slots={slots}
      events={events}
      summary={summary}
      nowMs={Date.now()}
    />
  );
}
