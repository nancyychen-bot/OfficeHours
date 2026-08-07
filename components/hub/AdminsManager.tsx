"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminsManager({ admins }: { admins: string[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function call(url: string, body: Record<string, string> | undefined, label: string) {
    setBusy(label); setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      return data;
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed." });
      return null;
    } finally { setBusy(null); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await call("/api/hub/admins", { action: "add", email }, "add")) {
      setMsg({ kind: "ok", text: `Added ${email.trim().toLowerCase()}.` });
      setEmail(""); router.refresh();
    }
  }
  async function remove(a: string) {
    if (!confirm(`Remove ${a} as an admin? They'll no longer be able to unclaim other people's spots.`)) return;
    if (await call("/api/hub/admins", { action: "remove", email: a }, `rm:${a}`)) router.refresh();
  }
  async function resync() {
    const r = await call("/api/hub/reconcile", undefined, "resync");
    if (r) setMsg({ kind: "ok", text: `Re-synced ${r.bookings} bookings (${r.recreated} recreated, ${r.updated} updated).` });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="text-lg font-semibold">Admins</h2>
        <p className="mb-4 mt-1 text-sm text-neutral-500">
          Admins can <span className="font-medium">unclaim any spot</span> (everyone else can only unclaim a 1:1 they claimed themselves).
        </p>
        <ul className="mb-4 divide-y divide-line rounded-md border border-line">
          {admins.length === 0 ? (
            <li className="px-4 py-2 text-sm text-neutral-500">No admins yet.</li>
          ) : admins.map((a) => (
            <li key={a} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-neutral-700">{a}</span>
              <button onClick={() => remove(a)} disabled={busy !== null} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">Remove</button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex items-center gap-2">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@makenotion.com"
            className="w-72 rounded-md border border-line px-3 py-1.5 text-sm" />
          <button type="submit" disabled={busy !== null} className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
            {busy === "add" ? "Adding…" : "Add admin"}
          </button>
          {msg && <span className={`text-sm ${msg.kind === "ok" ? "text-green-600" : "text-red-600"}`}>{msg.text}</span>}
        </form>
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="text-lg font-semibold">Notion sync</h2>
        <p className="mb-3 mt-1 text-sm text-neutral-500">
          The board auto-heals hourly — any stray edit to guest info (challenge, company, role, etc.) on a card is corrected
          back to the source of truth. Use this to fix it <span className="font-medium">right now</span> if you spot something off.
        </p>
        <button onClick={resync} disabled={busy !== null} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
          {busy === "resync" ? "Re-syncing…" : "Re-sync Notion from source"}
        </button>
      </section>
    </div>
  );
}
