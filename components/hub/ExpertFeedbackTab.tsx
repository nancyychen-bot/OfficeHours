import type { ExpertFeedbackListRow } from "@/lib/hub/expert-feedback";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function prettyDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : iso;
}

export function ExpertFeedbackTab({ rows }: { rows: ExpertFeedbackListRow[] }) {
  if (!rows.length) return <p className="text-sm text-neutral-500">No expert feedback yet.</p>;
  const th = "px-3 py-2 text-left text-xs font-medium text-neutral-500";
  const td = "px-3 py-2 align-top text-sm text-neutral-700";
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200">
      <table className="min-w-full divide-y divide-neutral-200">
        <thead className="bg-neutral-50">
          <tr>
            <th className={th}>Type</th>
            <th className={th}>Expert</th>
            <th className={th}>Event</th>
            <th className={th}>Date</th>
            <th className={th}>Guest</th>
            <th className={th}>Attended</th>
            <th className={th}>Rating</th>
            <th className={th}>Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r, i) => (
            <tr key={i} className={r.type === "General" ? "bg-purple-50/40" : ""}>
              <td className={td}>{r.type}</td>
              <td className={td}>{r.expert ?? "—"}</td>
              <td className={td}>{r.eventName ?? "—"}</td>
              <td className={td}>{prettyDate(r.eventDate)}</td>
              <td className={td}>{r.guest ?? "—"}</td>
              <td className={td}>{r.attended === null ? "—" : r.attended ? "✅" : "🚫"}</td>
              <td className={td}>{r.rating ?? "—"}</td>
              <td className={`${td} max-w-[420px] whitespace-pre-wrap`}>{r.note ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
