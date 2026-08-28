"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  TEMPLATE_REGISTRY,
  PLACEHOLDERS,
  SAMPLE_FIELDS,
  renderTemplate,
  buildVars,
  type TemplateKey,
  type TemplateDef,
} from "@/lib/email/templates";

export interface OverrideRow {
  key: string;
  draft_subject: string | null;
  draft_body: string | null;
  draft_note: string | null;
  draft_updated_at: string | null;
  live_subject: string | null;
  live_body: string | null;
  live_updated_at: string | null;
}

/** The attendee journey — emails grouped into lifecycle stages, in order. */
const STAGES: Array<{ title: string; blurb: string; keys: TemplateKey[] }> = [
  {
    title: "Before the event",
    blurb: "Warming guests up in the days leading up to Build Bar.",
    keys: ["prep_reminder__guest", "prep_reminder_day_before__guest", "prep_reminder_day_before_paid__guest"],
  },
  {
    title: "Booking a 1:1",
    blurb: "When a Notion expert claims (or releases) a guest's 1:1.",
    keys: ["assigned__guest", "assigned__helper", "already_claimed__helper", "reassigned_off__helper", "expert_unavailable__helper", "unclaim_denied__helper", "slot_changed__guest", "slot_changed__helper", "rematch_pending__guest", "unmatched_notice__guest", "double_booked__helper"],
  },
  {
    title: "At the event",
    blurb: "Check-in, no-shows, late arrivals, and each expert's day-of agenda.",
    keys: [
      "day_of_agenda__helper",
      "checked_in__guest__matched", "checked_in__guest__unmatched", "checked_in__guest__nohelp", "checked_in__helper",
      "no_show__helper", "arrived_after_no_show__guest__matched", "arrived_after_no_show__guest__nohelp", "arrived_after_no_show__helper",
    ],
  },
  {
    title: "Capacity & approval",
    blurb: "Approval outcomes — waitlisted, declined, or approved to cowork only.",
    keys: ["waitlisted__guest", "waitlisted__helper", "declined__guest", "declined__helper", "cowork_only__guest"],
  },
  {
    title: "Cancellations",
    blurb: "When a booking or the whole event falls through.",
    keys: ["cancelled__guest", "cancelled__helper", "event_cancelled__guest", "event_cancelled__helper", "guest_cancelled__helper"],
  },
  {
    title: "After the event",
    blurb: "Closing the loop and gathering feedback.",
    keys: ["feedback_request__guest", "feedback_reminder__guest"],
  },
];

// Safety net: surface ANY template not explicitly placed above, so newly-added
// emails always appear on this page automatically.
const CATEGORIZED = new Set<string>(STAGES.flatMap((s) => s.keys));
const UNCATEGORIZED = (Object.keys(TEMPLATE_REGISTRY) as TemplateKey[]).filter((k) => !CATEGORIZED.has(k));
const ALL_STAGES = UNCATEGORIZED.length
  ? [...STAGES, { title: "Other automations", blurb: "Everything else the system can send.", keys: UNCATEGORIZED }]
  : STAGES;

function roleLabel(role: string) {
  return role === "helper" ? "the Notion expert" : "the guest";
}

export function EmailEditor({ overrides }: { overrides: OverrideRow[] }) {
  const router = useRouter();
  const rows = new Map(overrides.map((r) => [r.key, r]));
  const [openKey, setOpenKey] = useState<TemplateKey | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function effective(key: TemplateKey, row: OverrideRow | undefined) {
    const def = TEMPLATE_REGISTRY[key];
    const liveSubject = row?.live_subject ?? def.subject;
    const liveBody = row?.live_body ?? def.body;
    const hasDraft = !!(row && (row.draft_subject != null || row.draft_body != null));
    const draftSubject = row?.draft_subject ?? liveSubject;
    const draftBody = row?.draft_body ?? liveBody;
    const pending = hasDraft && (draftSubject !== liveSubject || draftBody !== liveBody);
    return { def, liveSubject, liveBody, hasDraft, draftSubject, draftBody, pending };
  }

  function startEdit(key: TemplateKey) {
    const e = effective(key, rows.get(key));
    setOpenKey(key);
    setSubject(e.draftSubject);
    setBody(e.draftBody);
    setNote(rows.get(key)?.draft_note ?? "");
  }

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/hub/email-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Failed: ${j.error ?? res.status}`);
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function save(key: TemplateKey) {
    if (await post({ action: "save", key, subject, body, note })) { setOpenKey(null); router.refresh(); }
  }
  async function discard(key: TemplateKey) {
    if (!confirm("Discard this draft? The live copy stays as-is.")) return;
    if (await post({ action: "discard", key })) { if (openKey === key) setOpenKey(null); router.refresh(); }
  }
  async function publish(key: TemplateKey) {
    const passphrase = prompt("Enter the publish passphrase to make this live:");
    if (!passphrase) return;
    if (await post({ action: "publish", key, passphrase })) { router.refresh(); alert("Published — this copy is now live."); }
  }

  const pendingCount = (Object.keys(TEMPLATE_REGISTRY) as TemplateKey[]).filter((k) => effective(k, rows.get(k)).pending).length;

  const renderCard = (k: TemplateKey) => {
    const row = rows.get(k);
    const e = effective(k, row);
    const isOpen = openKey === k;
    const previewFrom = { subject: isOpen ? subject : e.draftSubject, body: isOpen ? body : e.draftBody };
    const preview = renderTemplate(previewFrom, buildVars((e.def as TemplateDef).role, SAMPLE_FIELDS));
    return (
      <div key={k} className="rounded-xl border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="font-medium text-neutral-800">{e.def.label}</span>
          {e.pending ? <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Pending</span> : null}
          {row?.live_updated_at ? <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">Customized</span> : null}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => (isOpen ? setOpenKey(null) : startEdit(k))} disabled={busy} className="rounded-md border border-line px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50">{isOpen ? "Close" : "Edit"}</button>
            {e.pending ? (
              <>
                <button onClick={() => publish(k)} disabled={busy} className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800">Publish</button>
                <button onClick={() => discard(k)} disabled={busy} className="rounded-md border border-line px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-50">Discard</button>
              </>
            ) : null}
          </div>
        </div>
        <div className="border-b border-line bg-neutral-50/50 px-4 py-1.5 text-xs text-neutral-500">
          <span className="font-medium text-neutral-600">Sent to {roleLabel(e.def.role)}</span> · Sent when {e.def.description}
        </div>

        {isOpen ? (
          <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500">Subject</label>
              <input value={subject} onChange={(ev) => setSubject(ev.target.value)} className="mb-3 w-full rounded-md border border-line px-2 py-1.5 text-sm outline-none focus:border-neutral-400" />
              <label className="mb-1 block text-xs font-medium text-neutral-500">Body</label>
              <textarea value={body} onChange={(ev) => setBody(ev.target.value)} rows={16} className="w-full rounded-md border border-line px-2 py-1.5 font-mono text-xs leading-relaxed outline-none focus:border-neutral-400" />
              <label className="mb-1 mt-3 block text-xs font-medium text-neutral-500">Note (optional — what changed / for review)</label>
              <input value={note} onChange={(ev) => setNote(ev.target.value)} className="w-full rounded-md border border-line px-2 py-1.5 text-sm outline-none focus:border-neutral-400" />
              <div className="mt-3 flex gap-2">
                <button onClick={() => save(k)} disabled={busy} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800">Save draft</button>
                <button onClick={() => setOpenKey(null)} disabled={busy} className="rounded-md border border-line px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">Cancel</button>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-neutral-500">Placeholders you can use</summary>
                <ul className="mt-1 space-y-0.5 text-[11px] text-neutral-500">
                  {PLACEHOLDERS.map((p) => (<li key={p.token}><code className="rounded bg-neutral-100 px-1">{p.token}</code> — {p.desc}</li>))}
                </ul>
                <p className="mt-1 text-[11px] text-neutral-400">Formatting: <code>**bold**</code>, <code>*italic*</code>, <code>[text](https://…)</code>. Blank line = new paragraph.</p>
              </details>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-neutral-500">Live preview (sample data)</div>
              <div className="rounded-md border border-line">
                <div className="border-b border-line bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-800">{preview.subject}</div>
                <div className="px-3 py-2 text-sm text-neutral-700" dangerouslySetInnerHTML={{ __html: preview.html }} />
              </div>
            </div>
          </div>
        ) : e.pending ? (
          <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-neutral-500">Live now</div>
              <div className="rounded-md border border-line bg-neutral-50/60 px-3 py-2 text-xs whitespace-pre-wrap text-neutral-500"><b>Subject:</b> {e.liveSubject}{"\n\n"}{e.liveBody}</div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-amber-700">Proposed (draft){row?.draft_note ? ` — ${row.draft_note}` : ""}</div>
              <div className="rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2 text-xs whitespace-pre-wrap text-neutral-700"><b>Subject:</b> {e.draftSubject}{"\n\n"}{e.draftBody}</div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Subject</div>
            <div className="mb-2 text-sm font-semibold text-neutral-800">{preview.subject}</div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Body</div>
            <div className="text-sm text-neutral-500" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-neutral-50 px-4 py-2 text-sm text-neutral-600">
        <span><b className="text-neutral-900">{pendingCount}</b> pending change{pendingCount === 1 ? "" : "s"}</span>
        <span className="text-neutral-400">·</span>
        <span>Editing saves a <b>draft</b>. Publishing (with the passphrase) makes it the copy that actually sends.</span>
      </div>

      <div className="space-y-10">
        {ALL_STAGES.map((stage, i) => (
          <section key={stage.title}>
            <div className="mb-3 flex items-baseline gap-3 border-b-2 border-neutral-900 pb-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">{i + 1}</span>
              <h2 className="text-lg font-bold text-neutral-900">{stage.title}</h2>
              <span className="text-sm text-neutral-400">{stage.blurb}</span>
            </div>
            <div className="space-y-3">
              {stage.keys.map((k) => renderCard(k))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
