"use client";

import type { HubBooking, HubEvent, SyncSummary } from "@/lib/hub/queries";
import { eventChips } from "@/lib/hub/format";
import { SyncStrip } from "./SyncStrip";
import { BookingsTab } from "./BookingsTab";
import { HubNav } from "./HubNav";

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
  const chips = eventChips(events);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <HubNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        Every Notion Build Bar booking across cities. Filter by event or status, or search a guest.
      </p>

      <SyncStrip summary={summary} nowMs={nowMs} />

      <div className="mt-6">
        <BookingsTab bookings={bookings} chips={chips} />
      </div>
    </main>
  );
}
