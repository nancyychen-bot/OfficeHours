import { listBookings, listEvents, syncSummary } from "@/lib/hub/queries";
import { Dashboard } from "@/components/hub/Dashboard";

// Always render fresh (reads the live DB); the middleware guards access.
export const dynamic = "force-dynamic";

export default async function HubPage() {
  const [bookings, events, summary] = await Promise.all([
    listBookings(),
    listEvents(), // still needed for the event (city+month) filter chips
    syncSummary(),
  ]);
  return <Dashboard bookings={bookings} events={events} summary={summary} nowMs={Date.now()} />;
}
