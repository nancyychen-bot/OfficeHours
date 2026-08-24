"use client";

import { useState } from "react";
import { emailKindLabel } from "@/lib/email/kind-label";

export interface EmailGroupView {
  eventKind: string;
  eventId: string | null;
  eventName: string | null;
  day: string;
  recipientCount: number;
  sentCount: number;
  unsentCount: number;
  lastAt: string;
}
interface Recipient { recipientEmail: string; guestName: string | null; status: string; resendId: string | null; createdAt: string; }
interface Content { subject: string; html: string; text: string; to: string[] }

export function EmailLog({ groups }: { groups: EmailGroupView[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<Record<string, Recipient[]>>({});
  const [content, setContent] = useState<Content | null | "loading" | "unavailable">(null);

  const keyOf = (g: EmailGroupView) => `${g.eventKind}|${g.eventId ?? ""}|${g.day}`;

  async function toggle(g: EmailGroupView) {
    const k = keyOf(g);
    if (openKey === k) { setOpenKey(null); return; }
    setOpenKey(k);
    if (!recipients[k]) {
      const params = new URLSearchParams({ kind: g.eventKind, day: g.day });
      if (g.eventId) params.set("event", g.eventId);
      const res = await fetch(`/api/hub/emails/recipients?${params}`);
      const json = await res.json();
      setRecipients((prev) => ({ ...prev, [k]: json.recipients ?? [] }));
    }
  }

  async function view(resendId: string | null) {
    if (!resendId) { setContent("unavailable"); return; }
    setContent("loading");
    const res = await fetch(`/api/hub/emails/content?resendId=${encodeURIComponent(resendId)}`);
    const json = await res.json();
    setContent(json.email ?? "unavailable");
  }

  return (
    <div className="divide-y divide-line rounded border border-line">
      {groups.length === 0 && <p className="p-4 text-sm text-neutral-500">No emails found.</p>}
      {groups.map((g) => {
        const k = keyOf(g);
        const rs = recipients[k] ?? [];
        return (
          <div key={k}>
            <button
              onClick={() => toggle(g)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-neutral-50"
            >
              <span>
                <span className="font-medium">{emailKindLabel(g.eventKind)}</span>
                {g.eventName ? <span className="text-neutral-500"> · {g.eventName}</span> : null}
                <span className="text-neutral-400"> · {g.day}</span>
              </span>
              <span className="shrink-0 text-neutral-500">
                {g.recipientCount > 1 ? `mass · ${g.recipientCount} recipients` : "1 recipient"}
                {g.unsentCount > 0 ? ` · ${g.unsentCount} unsent` : ""}
              </span>
            </button>
            {openKey === k && (
              <ul className="border-t border-line bg-neutral-50 px-4 py-2 text-sm">
                {rs.map((r) => (
                  <li key={r.recipientEmail} className="flex items-center justify-between gap-3 py-1">
                    <button className="text-left underline decoration-dotted hover:text-neutral-900" onClick={() => view(r.resendId)}>
                      {r.guestName ? `${r.guestName} ` : ""}&lt;{r.recipientEmail}&gt;
                    </button>
                    <span className="text-neutral-400">{r.status}</span>
                  </li>
                ))}
                {rs.length === 0 && <li className="py-1 text-neutral-400">Loading…</li>}
              </ul>
            )}
          </div>
        );
      })}

      {content !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setContent(null)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {content === "loading" && <p className="text-sm text-neutral-500">Loading…</p>}
            {content === "unavailable" && <p className="text-sm text-neutral-500">Content no longer available (not sent, or aged out of Resend).</p>}
            {content && content !== "loading" && content !== "unavailable" && (
              <>
                <p className="mb-1 text-xs text-neutral-500">To: {content.to.join(", ")}</p>
                <h2 className="mb-3 text-base font-semibold">{content.subject}</h2>
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: content.html || `<pre>${content.text}</pre>` }} />
              </>
            )}
            <button className="mt-4 text-sm text-neutral-500 underline" onClick={() => setContent(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
