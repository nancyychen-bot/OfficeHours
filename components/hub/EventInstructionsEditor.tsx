"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { renderComms, SAMPLE_FIELDS } from "@/lib/email/templates";

/** Per-event prep-email instructions editor, shown on each readiness event card.
 * The text is stored on the event row and injected (this event only) into the
 * three prep-reminder emails via {{eventInstructions}} — no cross-city bleed. */
export function EventInstructionsEditor({
  lumaEventId,
  initial,
}: {
  lumaEventId: string | null;
  initial: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(initial ?? "");
  const [saved, setSaved] = useState<string | null>(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  if (!lumaEventId) return null;

  const dirty = text.trim() !== (saved ?? "").trim();

  async function save() {
    setBusy(true);
    const res = await fetch("/api/hub/event-instructions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lumaEventId, instructions: text }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(text.trim());
      router.refresh();
    }
  }

  // Live preview of the T-3 prep email with this event's (unsaved) text, using
  // sample booking data — so the organizer sees where the block lands + that
  // links work before it ships.
  const preview = showPreview
    ? renderComms("prep_reminder", "guest", { ...SAMPLE_FIELDS, eventInstructions: text })
    : null;

  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-neutral-600">
          Prep-email instructions <span className="font-normal text-neutral-400">— check-in / where to go (this event only)</span>
        </label>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-xs text-blue-700 underline"
        >
          {showPreview ? "Hide preview" : "Preview prep email"}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="e.g. Check in at the front desk on level 2 and ask for the Notion Build Bar. Enter via the **Harrison St** door."
        className="w-full rounded border border-line px-2 py-1 text-sm"
      />
      <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-md border border-line bg-white px-2 py-0.5 font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {!dirty && (saved ?? "") ? <span className="text-green-700">✓ Saved</span> : null}
        <span className="text-neutral-400">Supports **bold**, [links](url), and bare URLs.</span>
      </div>
      {preview ? (
        <div className="mt-2 overflow-hidden rounded border border-line">
          <div className="border-b border-line bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-800">
            {preview.subject}
          </div>
          <div
            className="px-3 py-2 text-sm text-neutral-700"
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        </div>
      ) : null}
    </div>
  );
}
