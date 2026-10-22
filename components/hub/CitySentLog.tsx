import type { SentLogRow } from "@/lib/comms/log";
export function CitySentLog({ rows }: { rows: SentLogRow[] }) {
  return <div className="text-sm text-neutral-400">Sent log — {rows.length} rows — Task 11</div>;
}
