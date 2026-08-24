import { HubNav } from "@/components/hub/HubNav";
import { SettingsNav } from "@/components/hub/SettingsNav";
import { EmailLog } from "@/components/hub/EmailLog";
import { emailKindLabel } from "@/lib/email/kind-label";
import { listEmailGroups, listEmailFilterOptions } from "@/lib/db/email-correspondence";

export const dynamic = "force-dynamic";

export default async function SentLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; kind?: string; event?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? "0") || 0);
  const kind = sp.kind || null;
  const eventId = sp.event || null;

  const [{ groups, hasMore }, opts] = await Promise.all([
    listEmailGroups({ kind, eventId, page }),
    listEmailFilterOptions(),
  ]);

  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (kind) p.set("kind", kind);
    if (eventId) p.set("event", eventId);
    p.set("page", String(page));
    for (const [k, v] of Object.entries(over)) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <HubNav />
      <SettingsNav />
      <form className="mb-4 flex flex-wrap gap-2 text-sm" method="GET">
        <select name="kind" defaultValue={kind ?? ""} className="rounded border border-line px-2 py-1">
          <option value="">All kinds</option>
          {opts.kinds.map((k) => <option key={k} value={k}>{emailKindLabel(k)}</option>)}
        </select>
        <select name="event" defaultValue={eventId ?? ""} className="rounded border border-line px-2 py-1">
          <option value="">All events</option>
          {opts.events.map((e) => <option key={e.id} value={e.id}>{e.name ?? e.id}</option>)}
        </select>
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">Filter</button>
      </form>

      <EmailLog groups={groups} />

      <div className="mt-4 flex items-center justify-between text-sm">
        {page > 0
          ? <a className="underline" href={qs({ page: page - 1 })}>← Newer</a>
          : <span />}
        {hasMore
          ? <a className="underline" href={qs({ page: page + 1 })}>Older →</a>
          : <span />}
      </div>
    </main>
  );
}
