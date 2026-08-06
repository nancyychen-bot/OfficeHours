"use client";

import { useState } from "react";
import type { EventResult, Community, Contributor } from "@/lib/hub/results";
import { pct } from "@/lib/hub/format";
import { ResultCard, Stat, SectionLabel } from "./ResultCard";

function ContributorsCard({ contributors }: { contributors: Contributor[] }) {
  return (
    <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
      <SectionLabel dot="bg-amber-500">Top Voluntinos — 1:1s hosted</SectionLabel>
      {contributors.length ? (
        <ul className="space-y-1 text-sm">
          {contributors.map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex items-center justify-between border-b border-line py-1 last:border-0">
              <span className="text-neutral-700">
                <span className="mr-2 text-neutral-400">{i + 1}.</span>
                {c.name}
                {c.type ? <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">{c.type === "employee" ? "Notino" : "Ambassador"}</span> : null}
              </span>
              <span className="text-neutral-500">
                {c.sessions} 1:1{c.sessions === 1 ? "" : "s"}
                <span className="ml-2 text-neutral-400">· {c.events} event{c.events === 1 ? "" : "s"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-neutral-400">No completed 1:1s yet.</p>}
    </div>
  );
}

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

export function ResultsTab({ overall, perEvent, community, contributors }: { overall: EventResult; perEvent: EventResult[]; community: Community; contributors: Contributor[] }) {
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
        {isOverall ? <ContributorsCard contributors={contributors} /> : null}
      </div>
    </div>
  );
}
