"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { HubBooking, HubSlot, HubEvent, SyncSummary } from "@/lib/hub/queries";
import { eventChips } from "@/lib/hub/format";
import { SyncStrip } from "./SyncStrip";
import { BookingsTab } from "./BookingsTab";
import { SlotsTab } from "./SlotsTab";
import { EventsTab } from "./EventsTab";

type Tab = "bookings" | "slots" | "events";

export function Dashboard({
  bookings,
  slots,
  events,
  summary,
  nowMs,
}: {
  bookings: HubBooking[];
  slots: HubSlot[];
  events: HubEvent[];
  summary: SyncSummary;
  nowMs: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("bookings");
  const chips = eventChips(events);
  const tabs: { key: Tab; label: string }[] = [
    { key: "bookings", label: "Bookings" },
    { key: "slots", label: "Slots" },
    { key: "events", label: "Events" },
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Office Hours Hub</h1>
        <button
          onClick={() => router.refresh()}
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Refresh
        </button>
      </div>
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        One hub, three tables. Events hold the sessions, Slots hold the bookable windows,
        Bookings hold the guests. Filter by city — never fork the database.
      </p>

      <SyncStrip summary={summary} nowMs={nowMs} />

      <div className="mb-4 mt-6 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "bookings" ? <BookingsTab bookings={bookings} chips={chips} /> : null}
      {tab === "slots" ? <SlotsTab slots={slots} /> : null}
      {tab === "events" ? <EventsTab events={events} /> : null}
    </main>
  );
}
