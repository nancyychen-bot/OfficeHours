"use client";

import { useState } from "react";

interface Slot { id: string; name: string }
interface Booking {
  bookingId: string;
  eventName: string | null;
  city: string | null;
  eventDate: string | null;
  currentSlotId: string | null;
  currentSlotName: string | null;
  slots: Slot[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function prettyDate(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : iso;
}

export default function ChangeSlotPage() {
  const [email, setEmail] = useState("");
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [newSlotId, setNewSlotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ slotName?: string; eventName?: string | null } | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/change-slot/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lookup failed.");
      setBookings(data.bookings as Booking[]);
      if (data.bookings.length === 1) setSelected(data.bookings[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally { setBusy(false); }
  }

  async function submit() {
    if (!selected || !newSlotId) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/change-slot/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: selected.bookingId, email, newSlotId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't change the slot.");
      setDone({ slotName: data.slotName, eventName: data.eventName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally { setBusy(false); }
  }

  const card = "w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-sm";
  const input = "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500";
  const btn = "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50";

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-12">
      <div className={card}>
        <h1 className="text-lg font-semibold">Change your Notion Build Bar 1:1 time</h1>

        {done ? (
          <div className="mt-4 space-y-2 text-sm text-neutral-700">
            <p className="font-medium text-green-700">Your slot has been changed to {done.slotName}. 🎉</p>
            <p>We&rsquo;ll do our best to match you with a Notion expert for the new time, and email you a calendar invite once you&rsquo;re matched. You can close this page.</p>
          </div>
        ) : !bookings ? (
          <form onSubmit={lookup} className="mt-4 space-y-3">
            <p className="text-sm text-neutral-500">Enter the email you registered with to find your booking.</p>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" className={input} />
            <button type="submit" disabled={busy} className={btn}>{busy ? "Finding…" : "Find my booking"}</button>
          </form>
        ) : bookings.length === 0 ? (
          <div className="mt-4 space-y-3 text-sm text-neutral-600">
            <p>We couldn&rsquo;t find an upcoming 1:1 booking for <span className="font-medium">{email}</span>.</p>
            <button onClick={() => { setBookings(null); setError(null); }} className="text-blue-600 underline">Try another email</button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {bookings.length > 1 && !selected ? (
              <div className="space-y-2">
                <p className="text-sm text-neutral-500">Which event?</p>
                {bookings.map((b) => (
                  <button key={b.bookingId} onClick={() => setSelected(b)}
                    className="block w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50">
                    <span className="font-medium">{b.eventName ?? "Notion Build Bar"}</span>
                    <span className="text-neutral-500"> · {b.city ?? ""} · {prettyDate(b.eventDate)}</span>
                  </button>
                ))}
              </div>
            ) : selected ? (
              <div className="space-y-3">
                <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm">
                  <div className="font-medium">{selected.eventName ?? "Notion Build Bar"}</div>
                  <div className="text-neutral-500">{selected.city ?? ""} · {prettyDate(selected.eventDate)}</div>
                  <div className="mt-1 text-neutral-500">Current time: <span className="font-medium text-neutral-700">{selected.currentSlotName ?? "—"}</span></div>
                </div>
                <div>
                  <p className="mb-1 text-sm text-neutral-500">Pick a new time:</p>
                  <select value={newSlotId} onChange={(e) => setNewSlotId(e.target.value)} className={input}>
                    <option value="">Select a time…</option>
                    {selected.slots.filter((s) => s.id !== selected.currentSlotId).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-neutral-400">Changing your time frees up your current expert, and we&rsquo;ll re-match you for the new slot.</p>
                <div className="flex items-center gap-2">
                  <button onClick={submit} disabled={busy || !newSlotId} className={btn}>{busy ? "Changing…" : "Change my slot"}</button>
                  {bookings.length > 1 ? (
                    <button onClick={() => { setSelected(null); setNewSlotId(""); }} className="text-sm text-neutral-500 underline">Back</button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>
    </main>
  );
}
