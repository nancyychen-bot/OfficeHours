import { listDashboardData } from "@/lib/hub/queries";
import { computeResults } from "@/lib/hub/results";
import { ResultCard } from "@/components/hub/ResultCard";

// Public (no auth) per-event results — embeddable in Notion. Comments are shown
// anonymized (no attendee names). Always fresh. Hidden / non-Build-Bar events are
// excluded (via listDashboardData), so their embed shows "no results".
export const dynamic = "force-dynamic";

export default async function EmbedEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { events, bookings, feedback } = await listDashboardData();
  const { perEvent } = computeResults(bookings, feedback, events);
  const r = perEvent.find((e) => e.key === eventId);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      {r ? (
        <ResultCard r={r} anonymous showComments />
      ) : (
        <p className="rounded-lg border border-line bg-white p-6 text-center text-sm text-neutral-500">
          No results found for this event yet.
        </p>
      )}
      <p className="mt-3 text-center text-[11px] text-neutral-400">Notion Build Bar · live results</p>
    </main>
  );
}
