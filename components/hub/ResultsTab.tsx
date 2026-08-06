"use client";

import { useState } from "react";
import type { EventResult, Community } from "@/lib/hub/results";
import { pct } from "@/lib/hub/format";

type Tone = "neutral" | "green" | "amber" | "blue" | "violet";
const TONE: Record<Tone, { bg: string; text: string; bar: string }> = {
  neutral: { bg: "bg-neutral-50", text: "text-neutral-900", bar: "bg-neutral-400" },
  green: { bg: "bg-green-50", text: "text-green-700", bar: "bg-green-500" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", bar: "bg-amber-500" },
  blue: { bg: "bg-blue-50", text: "text-blue-700", bar: "bg-blue-500" },
  violet: { bg: "bg-violet-50", text: "text-violet-700", bar: "bg-violet-600" },
};

function Stat({ label, value, sub, tone = "neutral", ratio }: { label: string; value: string; sub?: string; tone?: Tone; ratio?: number }) {
  const t = TONE[tone];
  return (
    <div className={`rounded-lg ${t.bg} px-3 py-2.5`}>
      <div className={`text-2xl font-bold leading-none ${t.text}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-neutral-500">{label}</div>
      {ratio != null ? (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/70">
          <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
        </div>
      ) : null}
      {sub ? <div className="mt-1 text-[11px] text-neutral-400">{sub}</div> : null}
    </div>
  );
}

function SectionLabel({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 first:mt-0">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {children}
    </div>
  );
}

/** Horizontal labelled bar (count out of max). */
function Bar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-40 shrink-0 truncate text-neutral-600" title={label}>{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-neutral-100">
        <div className={`h-full rounded ${color}`} style={{ width: max > 0 ? `${Math.round((count / max) * 100)}%` : "0%" }} />
      </div>
      <span className="w-6 shrink-0 text-right font-medium text-neutral-700">{count}</span>
    </div>
  );
}

function ConfidenceBar({ r }: { r: EventResult }) {
  const c = r.confidence;
  const total = c.muchMore + c.somewhatMore + c.same + c.less;
  const seg = (n: number, cls: string, label: string) =>
    n > 0 ? <div className={`${cls} h-full`} style={{ width: `${(n / total) * 100}%` }} title={`${label}: ${n}`} /> : null;
  return (
    <div>
      <div className="mb-1 text-sm">
        <span className="font-semibold text-green-700">{r.pctMoreConfident != null ? pct(r.pctMoreConfident) : "—"}</span>
        <span className="text-neutral-500"> left more confident</span>
      </div>
      {total > 0 ? (
        <div className="flex h-3 overflow-hidden rounded bg-neutral-100">
          {seg(c.muchMore, "bg-green-600", "Much more")}
          {seg(c.somewhatMore, "bg-green-400", "Somewhat more")}
          {seg(c.same, "bg-neutral-300", "Same")}
          {seg(c.less, "bg-red-400", "Less")}
        </div>
      ) : <div className="text-xs text-neutral-400">No responses yet.</div>}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
        <span><b className="text-green-700">{c.muchMore}</b> much more</span>
        <span><b className="text-green-600">{c.somewhatMore}</b> somewhat</span>
        <span><b>{c.same}</b> same</span>
        <span><b className="text-red-600">{c.less}</b> less</span>
      </div>
    </div>
  );
}

function ResultCard({ r, highlight }: { r: EventResult; highlight?: boolean }) {
  const distMax = Math.max(1, ...([5, 4, 3, 2, 1] as const).map((n) => r.satisfactionDist[n]));
  const interestMax = Math.max(1, ...r.interests.map((i) => i.count));
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${highlight ? "border-neutral-900" : "border-line"}`}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-base font-semibold text-neutral-900">{r.label}</h3>
        <span className="text-[11px] uppercase tracking-wide text-neutral-400">
          {r.attendanceSource === "luma" ? "Luma-synced" : "from bookings"}
        </span>
      </div>

      <SectionLabel dot="bg-green-500">Attendance</SectionLabel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <Stat label="Registered" value={String(r.registered)} tone="neutral" />
        <Stat label="Approved" value={String(r.approved)} tone="blue" />
        <Stat label="Checked in" value={String(r.checkedIn)} tone="green" />
        <Stat label="No-shows" value={String(r.noShow)} tone="amber" />
        <Stat label="Waitlist" value={String(r.waitlist)} tone="amber" />
        <Stat label="Attendance" value={pct(r.attendanceRate)} tone="green" ratio={r.attendanceRate} />
      </div>

      <SectionLabel dot="bg-blue-500">1:1 coverage</SectionLabel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Requested" value={String(r.oneOnOneRequested)} tone="neutral" />
        <Stat label="Claimed" value={String(r.oneOnOneClaimed)} tone="blue" />
        <Stat label="Completed" value={String(r.oneOnOneCompleted)} tone="green" />
        <Stat label="Unmet" value={String(r.oneOnOneUnmet)} tone="amber" sub="requested, unclaimed" />
      </div>

      <SectionLabel dot="bg-violet-600">Satisfaction</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Responses" value={String(r.responses)} tone="violet" />
          <Stat label="Response rate" value={pct(r.responseRate)} tone="violet" ratio={r.responseRate} />
          <Stat label="Avg score" value={r.avgSatisfaction != null ? r.avgSatisfaction.toFixed(1) : "—"} tone="violet" sub="of 5" />
        </div>
        <div className="space-y-1">
          {([5, 4, 3, 2, 1] as const).map((n) => (
            <Bar key={n} label={`${n} ★`} count={r.satisfactionDist[n]} max={distMax} color="bg-violet-500" />
          ))}
        </div>
      </div>

      <SectionLabel dot="bg-emerald-500">Confidence lift</SectionLabel>
      <ConfidenceBar r={r} />

      {r.interests.length ? (
        <>
          <SectionLabel dot="bg-amber-500">Interested in</SectionLabel>
          <div className="space-y-1">
            {r.interests.map((i) => (
              <Bar key={i.label} label={i.label} count={i.count} max={interestMax} color="bg-amber-500" />
            ))}
          </div>
        </>
      ) : null}

      {r.comments.length ? (
        <>
          <SectionLabel dot="bg-neutral-400">Voice of the attendee</SectionLabel>
          <ul className="space-y-2 text-sm">
            {r.comments.slice(0, 8).map((c, i) => (
              <li key={i} className="rounded-md border border-line bg-neutral-50/60 px-3 py-2">
                {c.highlight ? <div className="text-neutral-700">“{c.highlight}”</div> : null}
                {c.featureIntent ? <div className="text-neutral-500">Will try: {c.featureIntent}</div> : null}
                {c.guestName ? <div className="mt-0.5 text-[11px] text-neutral-400">— {c.guestName}</div> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
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
      <div className="space-y-4">
        <ResultCard r={active} highlight={isOverall} />
        {isOverall ? <CommunityCard community={community} /> : null}
      </div>
    </div>
  );
}
