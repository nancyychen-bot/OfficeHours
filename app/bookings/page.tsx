import { listDashboardData, syncSummary } from "@/lib/hub/queries";
import { Dashboard } from "@/components/hub/Dashboard";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const [{ events, bookings }, summary] = await Promise.all([listDashboardData(), syncSummary()]);
  return <Dashboard bookings={bookings} events={events} summary={summary} nowMs={Date.now()} />;
}
