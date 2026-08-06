import { listBookings, listEvents, syncSummary } from "@/lib/hub/queries";
import { Dashboard } from "@/components/hub/Dashboard";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const [bookings, events, summary] = await Promise.all([listBookings(), listEvents(), syncSummary()]);
  return <Dashboard bookings={bookings} events={events} summary={summary} nowMs={Date.now()} />;
}
