import type { EventResult } from "@/lib/hub/results";
import { pct } from "@/lib/hub/format";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-line bg-neutral-50/60 px-3 py-2">
      <div className="text-lg font-semibold text-neutral-900">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
      {sub ? <div className="text-xs text-neutral-400">{sub}</div> : null}
    </div>
  );
}

function ResultCard({ r, highlight }: { r: EventResult; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? "border-neutral-800 bg-white" : "border-line bg-white"}`}>
      <h3 className="mb-3 text-sm font-semibold text-neutral-800">{r.label}</h3>

      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">Attendance</div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Registered" value={String(r.registered)} />
        <Stat label="Approved" value={String(r.approved)} />
        <Stat label="Checked in" value={String(r.checkedIn)} />
        <Stat label="No-shows" value={String(r.noShow)} />
        <Stat label="Attendance" value={pct(r.attendanceRate)} sub="checked-in ÷ approved" />
      </div>

      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">1:1 coverage</div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Requested" value={String(r.oneOnOneRequested)} />
        <Stat label="Claimed" value={String(r.oneOnOneClaimed)} />
        <Stat label="Completed" value={String(r.oneOnOneCompleted)} />
      </div>

      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">Satisfaction</div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Responses" value={String(r.responses)} />
        <Stat label="Response rate" value={pct(r.responseRate)} sub="of checked-in" />
        <Stat label="Avg score" value={r.avgSatisfaction != null ? r.avgSatisfaction.toFixed(1) : "—"} sub="out of 5" />
      </div>
    </div>
  );
}

export function ResultsTab({ overall, perEvent }: { overall: EventResult; perEvent: EventResult[] }) {
  return (
    <div className="space-y-4">
      <ResultCard r={overall} highlight />
      {perEvent.length === 0 ? (
        <p className="text-sm text-neutral-400">No events yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {perEvent.map((r) => (
            <ResultCard key={r.key} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
