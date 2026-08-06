"use client";

import { useState } from "react";
import type { EventResult, Community } from "@/lib/hub/results";
import { pct } from "@/lib/hub/format";
import { ResultCard, Stat, SectionLabel } from "./ResultCard";

function CommunityCard({ community }: { community: Community }) {
  return (
    <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
      <SectionLabel dot="bg-violet-600">Community — repeat attendance</SectionLabel>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label="Unique attendees" value={String(community.uniqueAttendees)} tone="neutral" />
        <Stat label="Repeat attendees" value={String(community.repeatAttendees)} tone="violet" />
        <Stat label="Repeat rate" value={pct(community.repeatRate)} tone="violet" ratio={community.repeatRate} />
      </div>
      {community.top.length ? (
        <ul className="space-y-1 text-sm">
          {community.top.map((p) => (
            <li key={p.email} className="flex justify-between border-b border-line py-1 last:border-0">
              <span className="text-neutral-700">{p.name ?? p.email}</span>
              <span className="text-neutral-500">{p.events} events</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-neutral-400">No repeat attendees yet.</p>}
    </div>
  );
}

export function ResultsTab({ overall, perEvent, community }: { overall: EventResult; perEvent: EventResult[]; community: Community }) {
  const tabs = [overall, ...perEvent];
  const [key, setKey] = useState(overall.key);
  const active = tabs.find((t) => t.key === key) ?? overall;
  const isOverall = active.key === "__all__";

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const on = t.key === key;
          return (
            <button
              key={t.key}
              onClick={() => setKey(t.key)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-line bg-white text-neutral-700 hover:bg-neutral-50"}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {!isOverall ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>Public link (no login) to embed in Notion:</span>
          <a href={`/embed/${active.key}`} target="_blank" rel="noreferrer" className="break-all text-blue-600 underline">
            {(typeof window !== "undefined" ? window.location.origin : "")}/embed/{active.key}
          </a>
        </div>
      ) : null}
      <div className="space-y-4">
        {/* Comments are per-event only (not on the overall roll-up). */}
        <ResultCard r={active} highlight={isOverall} showComments={!isOverall} />
        {isOverall ? <CommunityCard community={community} /> : null}
      </div>
    </div>
  );
}
