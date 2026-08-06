"use client";

import { useState } from "react";
import type { EventResult } from "@/lib/hub/results";
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
    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {children}
    </div>
  );
}

function Dots({ score }: { score: number }) {
  return (
    <span className="ml-2 inline-flex gap-0.5 align-middle">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`h-1.5 w-1.5 rounded-full ${n <= Math.round(score) ? "bg-violet-600" : "bg-neutral-200"}`} />
      ))}
    </span>
  );
}

function ResultCard({ r, highlight }: { r: EventResult; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${highlight ? "border-neutral-900" : "border-line"}`}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-neutral-900">{r.label}</h3>
        {r.avgSatisfaction != null ? (
          <div className="flex items-center text-sm text-neutral-500">
            <span className="font-semibold text-violet-700">{r.avgSatisfaction.toFixed(1)}</span>
            <span className="text-neutral-400">/5</span>
            <Dots score={r.avgSatisfaction} />
          </div>
        ) : null}
      </div>

      <SectionLabel dot="bg-green-500">Attendance</SectionLabel>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Registered" value={String(r.registered)} tone="neutral" />
        <Stat label="Approved" value={String(r.approved)} tone="blue" />
        <Stat label="Checked in" value={String(r.checkedIn)} tone="green" />
        <Stat label="No-shows" value={String(r.noShow)} tone="amber" />
        <Stat label="Attendance" value={pct(r.attendanceRate)} tone="green" ratio={r.attendanceRate} sub="checked-in ÷ approved" />
      </div>

      <SectionLabel dot="bg-blue-500">1:1 coverage</SectionLabel>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Requested" value={String(r.oneOnOneRequested)} tone="neutral" />
        <Stat label="Claimed" value={String(r.oneOnOneClaimed)} tone="blue" />
        <Stat label="Completed" value={String(r.oneOnOneCompleted)} tone="green" />
      </div>

      <SectionLabel dot="bg-violet-600">Satisfaction</SectionLabel>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Responses" value={String(r.responses)} tone="violet" />
        <Stat label="Response rate" value={pct(r.responseRate)} tone="violet" ratio={r.responseRate} sub="of checked-in" />
        <Stat label="Avg score" value={r.avgSatisfaction != null ? `${r.avgSatisfaction.toFixed(1)}` : "—"} tone="violet" sub="out of 5" />
      </div>
    </div>
  );
}

export function ResultsTab({ overall, perEvent }: { overall: EventResult; perEvent: EventResult[] }) {
  const tabs = [overall, ...perEvent];
  const [key, setKey] = useState(overall.key);
  const active = tabs.find((t) => t.key === key) ?? overall;

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
      <ResultCard r={active} highlight={active.key === "__all__"} />
    </div>
  );
}
