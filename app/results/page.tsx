import { listBookings, listFeedback, listEvents } from "@/lib/hub/queries";
import { computeResults } from "@/lib/hub/results";
import { HubNav } from "@/components/hub/HubNav";
import { ResultsTab } from "@/components/hub/ResultsTab";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const [bookings, feedback, events] = await Promise.all([listBookings(), listFeedback(), listEvents()]);
  const { overall, perEvent } = computeResults(bookings, feedback, events);
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <HubNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        Attendance, 1:1 coverage, and satisfaction — overall and per event.
      </p>
      <ResultsTab overall={overall} perEvent={perEvent} />
    </main>
  );
}
