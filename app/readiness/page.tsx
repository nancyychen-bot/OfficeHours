import { checkReadiness, type CalendarReport, type EventReport } from "@/lib/readiness/check";
import type { Issue } from "@/lib/readiness/evaluate";
import { HubNav } from "@/components/hub/HubNav";
import { ReadinessAckButton } from "@/components/hub/ReadinessAckButton";
import { RegisterUntrackedButton } from "@/components/hub/RegisterUntrackedButton";

export const metadata = { title: "Build Bar readiness" };
export const dynamic = "force-dynamic"; // always run live checks

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <span className="text-green-700">✓ ready</span>;
  return (
    <ul className="space-y-0.5">
      {issues.map((i, n) => (
        <li key={n} className={i.level === "error" ? "text-red-700" : "text-amber-700"}>
          {i.level === "error" ? "🔴" : "🟠"} {i.message}
        </li>
      ))}
    </ul>
  );
}

export default async function ReadinessPage() {
  const report = await checkReadiness();
  const rowClass = (issues: Issue[]) =>
    issues.some((i) => i.level === "error")
      ? "bg-red-50"
      : issues.length
        ? "bg-amber-50"
        : "bg-green-50";

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8">
      <HubNav />
      <h1 className="text-lg font-semibold">Build Bar readiness</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Live setup check for connected calendars and the next {report.generatedForDays} days of events.{" "}
        {report.errorCount + report.warnCount === 0 ? (
          <span className="text-green-700">Everything looks ready. ✓</span>
        ) : (
          <span>
            <strong className="text-red-700">{report.errorCount} error{report.errorCount === 1 ? "" : "s"}</strong>,{" "}
            <strong className="text-amber-700">{report.warnCount} warning{report.warnCount === 1 ? "" : "s"}</strong>.
          </span>
        )}
      </p>

      {report.untracked.length > 0 ? (
        <div className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-red-800">
              🔴 Untracked events receiving registrations ({report.untracked.length})
            </h2>
            <RegisterUntrackedButton label="Register & backfill all" />
          </div>
          <p className="mt-1 text-xs text-red-700">
            People are registering for these on Luma, but the event isn&apos;t in the hub — so registrations are being
            dropped. Register each to pull in everyone who already signed up (or paste its manage URL into /add-event).
          </p>
          <div className="mt-2 space-y-1.5 text-sm">
            {report.untracked.map((u) => (
              <div key={u.eventId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-3 py-1.5">
                <span>
                  <strong>{u.name ?? u.eventId}</strong> — {u.guestCount} guest{u.guestCount === 1 ? "" : "s"} dropped
                  {u.sampleGuest ? <span className="text-neutral-500"> · e.g. {u.sampleGuest}</span> : null}
                  <span className="ml-1 font-mono text-xs text-neutral-400">{u.eventId}</span>
                </span>
                <RegisterUntrackedButton eventId={u.eventId} label="Register & backfill" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <h2 className="mt-6 text-sm font-semibold text-neutral-700">
        Connected calendars ({report.calendars.length})
      </h2>
      <div className="mt-2 space-y-2 text-sm">
        {report.calendars.length === 0 ? (
          <p className="text-neutral-500">No calendars connected yet.</p>
        ) : (
          report.calendars.map((c: CalendarReport) => (
            <div key={c.id} className={`rounded-md px-3 py-2 ${rowClass(c.issues)}`}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{c.id}</span>
                {c.cities.length ? <span className="text-neutral-500">· {c.cities.join(", ")}</span> : null}
                {c.calendarUrl ? (
                  <a href={c.calendarUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                    open in Luma ↗
                  </a>
                ) : (
                  <span className="text-neutral-400">no calendar URL</span>
                )}
                {c.calendarId ? <span className="ml-auto font-mono text-xs text-neutral-400">{c.calendarId}</span> : null}
              </div>
              <div className="mt-0.5">
                <IssueList issues={c.issues} />
              </div>
            </div>
          ))
        )}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-neutral-700">
        Upcoming events{" "}
        <span className="font-normal text-neutral-500">
          ({report.events.filter((e) => e.acked).length} of {report.events.length} marked complete)
        </span>
      </h2>
      <div className="mt-2 space-y-2 text-sm">
        {report.events.length === 0 ? (
          <p className="text-neutral-500">No upcoming events in the window.</p>
        ) : (
          report.events.map((e: EventReport, n: number) => (
            <div key={n} className={`rounded-md px-3 py-2 ${e.acked ? "bg-green-50/60 opacity-75" : rowClass(e.issues)}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">
                  {e.acked ? "✓ " : ""}
                  {e.name} <span className="font-normal text-neutral-500">— {e.city ?? "no city"} · {e.eventDate}</span>
                </div>
                <ReadinessAckButton lumaEventId={e.lumaEventId} acked={e.acked} />
              </div>
              {e.acked && e.issues.some((i) => i.level === "error") ? (
                <p className="mt-0.5 text-xs text-red-700">Marked complete, but still has errors below — not sent in the alert email.</p>
              ) : null}
              <div className="mt-0.5">
                <IssueList issues={e.issues} />
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
