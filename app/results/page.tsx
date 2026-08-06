import { listBookings, listFeedback, listEvents } from "@/lib/hub/queries";
import { computeResults, computeCommunity } from "@/lib/hub/results";
import { HubNav } from "@/components/hub/HubNav";
import { KpiBand } from "@/components/hub/KpiBand";
import { ResultsTab } from "@/components/hub/ResultsTab";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const [bookings, feedback, events] = await Promise.all([listBookings(), listFeedback(), listEvents()]);
  const { overall, perEvent } = computeResults(bookings, feedback, events);
  const community = computeCommunity(bookings);
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <HubNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        High-level numbers and insight — attendance, 1:1 coverage, satisfaction, confidence lift, interests, and repeat attendance.
      </p>
      <KpiBand overall={overall} community={community} eventCount={perEvent.length} />
      <ResultsTab overall={overall} perEvent={perEvent} community={community} />
    </main>
  );
}
