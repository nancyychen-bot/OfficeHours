import { HubNav } from "@/components/hub/HubNav";
import { SettingsNav } from "@/components/hub/SettingsNav";
import { EventInstructionsManager, type InstructionsEvent } from "@/components/hub/EventInstructionsManager";
import { listEventsInDateRange } from "@/lib/db/events";

export const metadata = { title: "Event prep instructions" };
export const dynamic = "force-dynamic";

export default async function EventInstructionsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
  const rows = await listEventsInDateRange(today, until);

  const events: InstructionsEvent[] = rows
    .map((e) => ({
      lumaEventId: (e.luma_event_id as string) ?? null,
      name: e.name as string,
      city: (e.city as string) ?? null,
      eventDate: e.event_date as string,
      prepInstructions: (e.prep_instructions as string) ?? null,
    }))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <HubNav />
      <SettingsNav />
      <h1 className="text-lg font-semibold">Event prep instructions</h1>
      <p className="mb-5 mt-1 max-w-2xl text-sm text-neutral-500">
        Add per-event logistics (how to check in, where to go, which entrance) for the next 120 days of events. Each
        event&apos;s text appears only in <strong>that event&apos;s</strong> prep-reminder emails — city instructions can
        never bleed into another city&apos;s email. Leave blank for none (the default). Supports <code>**bold**</code>,{" "}
        <code>[links](url)</code>, and bare URLs.
      </p>
      <EventInstructionsManager events={events} />
    </main>
  );
}
