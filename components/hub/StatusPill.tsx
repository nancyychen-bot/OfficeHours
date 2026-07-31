import { statusPill } from "@/lib/hub/format";

export function StatusPill({ status }: { status: string }) {
  const p = statusPill(status);
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${p.className}`}>{p.label}</span>;
}
