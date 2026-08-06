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

const KEYS = Object.keys(TEMPLATE_REGISTRY) as TemplateKey[];

function roleLabel(role: string) {
  return role === "helper" ? "Notion expert" : "guest";
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
    if (await post({ action: "save", key, subject, body, note })) {
      setOpenKey(null);
      router.refresh();
    }
  }
  async function discard(key: TemplateKey) {
    if (!confirm("Discard this draft? The live copy stays as-is.")) return;
    if (await post({ action: "discard", key })) {
      if (openKey === key) setOpenKey(null);
      router.refresh();
    }
  }
  async function publish(key: TemplateKey) {
    const passphrase = prompt("Enter the publish passphrase to make this live:");
    if (!passphrase) return;
    if (await post({ action: "publish", key, passphrase })) {
      router.refresh();
      alert("Published — this copy is now live.");
    }
  }

  const pendingCount = KEYS.filter((k) => effective(k, rows.get(k)).pending).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-neutral-50 px-4 py-2 text-sm text-neutral-600">
        <span><b className="text-neutral-900">{pendingCount}</b> pending change{pendingCount === 1 ? "" : "s"}</span>
        <span className="text-neutral-400">·</span>
        <span>Editing saves a <b>draft</b>. Publishing (with the passphrase) makes it the copy that actually sends.</span>
      </div>

      <div className="space-y-3">
        {KEYS.map((key) => {
          const row = rows.get(key);
          const e = effective(key, row);
          const isOpen = openKey === key;
          const previewFrom = { subject: isOpen ? subject : e.draftSubject, body: isOpen ? body : e.draftBody };
          const preview = renderTemplate(previewFrom, buildVars((e.def as TemplateDef).role, SAMPLE_FIELDS));
          return (
            <div key={key} className="rounded-xl border border-line bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                <span className="font-medium text-neutral-800">{e.def.label}</span>
                <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${e.def.role === "helper" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-800"}`}>{roleLabel(e.def.role)}</span>
                {e.pending ? <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Pending</span> : null}
                {row?.live_updated_at ? <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">Customized</span> : null}
                <span className="text-xs text-neutral-400">{e.def.description}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => (isOpen ? setOpenKey(null) : startEdit(key))} disabled={busy} className="rounded-md border border-line px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50">{isOpen ? "Close" : "Edit"}</button>
                  {e.pending ? (
                    <>
                      <button onClick={() => publish(key)} disabled={busy} className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800">Publish</button>
                      <button onClick={() => discard(key)} disabled={busy} className="rounded-md border border-line px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-50">Discard</button>
                    </>
                  ) : null}
                </div>
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
                      <button onClick={() => save(key)} disabled={busy} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800">Save draft</button>
                      <button onClick={() => setOpenKey(null)} disabled={busy} className="rounded-md border border-line px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">Cancel</button>
                    </div>
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-neutral-500">Placeholders you can use</summary>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-neutral-500">
                        {PLACEHOLDERS.map((p) => (
                          <li key={p.token}><code className="rounded bg-neutral-100 px-1">{p.token}</code> — {p.desc}</li>
                        ))}
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
                    <div className="rounded-md border border-line bg-neutral-50/60 px-3 py-2 text-xs whitespace-pre-wrap text-neutral-500">{e.liveBody}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-amber-700">Proposed (draft){row?.draft_note ? ` — ${row.draft_note}` : ""}</div>
                    <div className="rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2 text-xs whitespace-pre-wrap text-neutral-700">{e.draftBody}</div>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-2 text-sm text-neutral-500" dangerouslySetInnerHTML={{ __html: preview.html }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
