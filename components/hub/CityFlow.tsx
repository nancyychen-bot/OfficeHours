"use client";

import { useState } from "react";
import { nodesFor, FLOW_PHASES, type Audience, type FlowNode } from "@/lib/comms/flow";

function Pill({ t }: { t: FlowNode["trigger"] }) {
  const scheduled = t.kind === "schedule";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${scheduled ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
      {t.label}
    </span>
  );
}

export function CityFlow() {
  const [audience, setAudience] = useState<Audience>("guest");
  const [selected, setSelected] = useState<FlowNode | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; label: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function pick(node: FlowNode) {
    setSelected(node);
    setPreview(null);
    setLoading(true);
    const res = await fetch(`/api/hub/flow-preview?kind=${node.commsKinds[0]}&role=${node.recipientRole}`);
    setPreview(res.ok ? await res.json() : null);
    setLoading(false);
  }

  const nodes = nodesFor(audience);
  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <div className="mb-4 inline-flex overflow-hidden rounded-full border border-line text-sm">
          {(["guest", "expert"] as Audience[]).map((a) => (
            <button key={a} onClick={() => { setAudience(a); setSelected(null); setPreview(null); }}
              className={`px-4 py-1 ${audience === a ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>
              {a === "guest" ? "Guest" : "Expert"}
            </button>
          ))}
        </div>
        {FLOW_PHASES.filter((p) => nodes.some((n) => n.phase === p.id)).map((p) => (
          <div key={p.id} className="mb-5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-amber-700/70">{p.label}</div>
            <div className="flex flex-col gap-2">
              {nodes.filter((n) => n.phase === p.id).map((n) => (
                <button key={n.id} onClick={() => pick(n)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === n.id ? "border-green-600 bg-green-50/40" : "border-line bg-white hover:bg-neutral-50"}`}>
                  <Pill t={n.trigger} />
                  <span className="flex-1">
                    <span className="text-neutral-400">○ ✉ </span>{n.label}
                    {n.detail ? <span className="mt-0.5 block text-[11px] text-neutral-500">{n.detail}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="w-[360px] shrink-0">
        {selected ? (
          <div className="sticky top-3 overflow-hidden rounded-xl border border-line bg-white">
            <div className="border-b border-line bg-green-50/60 px-4 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-green-700">Template — what this email says</div>
              <div className="mt-1 text-sm font-semibold">{preview?.label ?? selected.label}</div>
              <div className="mt-0.5 text-[11px] text-neutral-500">trigger: {selected.trigger.label} · to {selected.recipientRole === "helper" ? "Expert" : "Guest"}</div>
            </div>
            <div className="px-4 py-3 text-sm">
              {loading ? <div className="text-neutral-400">Loading…</div> : preview ? (
                <>
                  <div className="text-[10px] uppercase text-neutral-400">Subject</div>
                  <div className="mb-3">{preview.subject}</div>
                  <div className="text-[10px] uppercase text-neutral-400">Body</div>
                  <div className="prose prose-sm mt-1 max-w-none" dangerouslySetInnerHTML={{ __html: preview.html }} />
                </>
              ) : <div className="text-neutral-400">No template for this node.</div>}
            </div>
            <div className="border-t border-line bg-neutral-50 px-4 py-2 text-[11px] text-neutral-400">
              shows {`{{tokens}}`} — the template, not a specific send · edit/translate = SP2/SP3
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-neutral-400">Click an email to preview its template.</div>
        )}
      </div>
    </div>
  );
}
