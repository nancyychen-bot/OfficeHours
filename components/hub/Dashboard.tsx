"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { HubBooking, HubEvent, SyncSummary } from "@/lib/hub/queries";
import { eventChips } from "@/lib/hub/format";
import { SyncStrip } from "./SyncStrip";
import { BookingsTab } from "./BookingsTab";

export function Dashboard({
  bookings,
  events,
  summary,
  nowMs,
}: {
  bookings: HubBooking[];
  events: HubEvent[];
  summary: SyncSummary;
  nowMs: number;
}) {
  const router = useRouter();
  const chips = eventChips(events);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Office Hours Hub</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/add-event"
            target="_blank"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            + Add event
          </Link>
          <button
            onClick={() => router.refresh()}
            className="rounded-md border border-line bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Refresh
          </button>
        </div>
      </div>
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        Every Office Hours booking across cities. Filter by event or status, or search a guest.
      </p>

      <SyncStrip summary={summary} nowMs={nowMs} />

      <div className="mt-6">
        <BookingsTab bookings={bookings} chips={chips} />
      </div>
    </main>
  );
}
