import { listDashboardData, listArchivedEvents } from "@/lib/hub/queries";
import { computeResults, computeCommunity, computeContributors } from "@/lib/hub/results";
import { HubNav } from "@/components/hub/HubNav";
import { ResultsTab } from "@/components/hub/ResultsTab";
import { ArchivedEvents } from "@/components/hub/ArchivedEvents";

// Always render fresh (reads the live DB); the middleware guards access.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [{ events, bookings, feedback }, archived] = await Promise.all([listDashboardData(), listArchivedEvents()]);
  const { overall, perEvent, unattributed } = computeResults(bookings, feedback, events);
  const community = computeCommunity(bookings);
  const contributors = computeContributors(bookings);
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <HubNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        High-level numbers and insight — attendance, 1:1 coverage, satisfaction, confidence lift, interests, and repeat attendance.
      </p>
      <ResultsTab overall={overall} perEvent={perEvent} community={community} contributors={contributors} unattributed={unattributed} />
      <ArchivedEvents archived={archived} />
    </main>
  );
}
