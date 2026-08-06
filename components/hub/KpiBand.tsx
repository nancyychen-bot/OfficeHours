import type { EventResult, Community } from "@/lib/hub/results";
import { pct } from "@/lib/hub/format";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3 shadow-sm">
      <div className="text-2xl font-bold text-neutral-900">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-neutral-500">{label}</div>
      {sub ? <div className="text-[11px] text-neutral-400">{sub}</div> : null}
    </div>
  );
}

export function KpiBand({ overall, community, eventCount }: { overall: EventResult; community: Community; eventCount: number }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      <Kpi label="Events" value={String(eventCount)} />
      <Kpi label="Registered" value={String(overall.registered)} sub={overall.waitlist ? `${overall.waitlist} waitlisted` : undefined} />
      <Kpi label="Attended" value={String(overall.checkedIn)} sub={`${pct(overall.attendanceRate)} of approved`} />
      <Kpi label="1:1s done" value={String(overall.oneOnOneCompleted)} sub={overall.oneOnOneUnmet ? `${overall.oneOnOneUnmet} unmet` : undefined} />
      <Kpi label="Avg satisfaction" value={overall.avgSatisfaction != null ? overall.avgSatisfaction.toFixed(1) : "—"} sub="out of 5" />
      <Kpi label="More confident" value={overall.pctMoreConfident != null ? pct(overall.pctMoreConfident) : "—"} sub="left the event" />
      <Kpi label="Repeat rate" value={pct(community.repeatRate)} sub={`${community.repeatAttendees} of ${community.uniqueAttendees}`} />
      <Kpi label="Feedback rate" value={pct(overall.responseRate)} sub={`${overall.responses} responses`} />
    </div>
  );
}
